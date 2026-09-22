-- 0148_content_post.sql
-- P2 ของชั้นวัดผล content (ต่อจาก 0145/0146, Tech Lead brief 22 ก.ย. 69) —
-- โจทย์เจ้าของ: "พอทำคอนเทนต์ออกมาแล้วอยากจะให้มีให้กรอก Link ไปยัง TikTok หรือ
-- platform อื่นๆ เพื่อวัดผลของ content และ engagement ต่อ". ไฟล์นี้คือที่เก็บ
-- ลิงก์โพสต์ (content_post) + ตัวเลข engagement แบบ time-series ต่อวันธุรกิจไทย
-- (content_post_metric). ยังไม่ต่อ TikTok API (P3) — P2 กรอกมือ แต่ save_count
-- ไม่ใช่ของชั่วคราว: TikTok Display API ไม่มี save_count ให้เลย มีแต่ที่เจ้าของ
-- เห็นใน TikTok Studio ตรงๆ ⇒ ช่องทางเดียวที่ได้ตัวเลขนี้คือกรอกมือ ถาวร ไม่ใช่
-- แค่รอต่อ API.
--
-- Additive only: create table/function ใหม่ล้วน ไม่แก้ตาราง/ฟังก์ชันเดิมที่มีอยู่
-- แล้วแม้แต่บรรทัดเดียว.
--
-- ============================================================================
-- 🔴 รอบ 2 (23 ก.ย. 69) — แก้ตามรายงาน security-auditor: ผ่านด้านความปลอดภัย
-- สะอาดทุกข้อ (grant/injection/RLS/definer/overload/เขตเวลา/trap 14/18/19) แต่
-- NO-GO เพราะ "ตัวเลขโกหกเงียบๆ ได้ 3 ทาง" ที่ชุดทดสอบเดิมไม่ครอบ (ทุกเคสเดิมยิง
-- RPC ครั้งเดียวต่อสถานการณ์ ไม่มีเคสยิง 2 ครั้งวันเดียวกันด้วยพารามิเตอร์ต่างกัน):
--
-- H1 — is_regression คำนวณจาก "ค่าที่ส่งมารอบนี้" (มักเป็น null เพราะ
--      null-preserving) ไม่ใช่ "ค่าหลังผสมที่จะถูกเก็บจริง" ⇒ ยิงซ้ำวันเดียวกัน
--      ด้วยคอลัมน์อื่นล้างธงเป็น false ทั้งที่ค่าจริงยังต่ำกว่าเดิม แก้: คำนวณค่า
--      "หลังผสม" ก่อน (อ่านแถวของวันนี้มา merge แบบเดียวกับ on conflict) แล้วเทียบ
--      กับ max ของ "วันก่อนหน้าเท่านั้น" (captured_on < วันนี้) — ปิดทั้งบั๊กเดิม
--      และปิด false positive ตอนแก้เลขผิดวันเดียวกันไปพร้อมกัน.
-- H2 — แก้ posted_at ของโพสต์เดิมผ่าน content_post_upsert (ฟีเจอร์ที่ถูกแล้ว —
--      วางเวลาผิดแล้วแก้เป็นเรื่องปกติ) แต่ age_days ของ metric เดิมไม่ถูกคิดใหม่
--      ⇒ ค้างอายุผิดถาวร แก้: recompute age_days เฉพาะแถวที่ค่าเปลี่ยนจริง
--      (3j-migration-traps #19) + กันก่อนว่าจะไม่เกิด age_days ติดลบย้อนหลัง.
-- H3 — เรียก content_post_metric_upsert โดยไม่ส่งตัวเลขอะไรเลยสร้างแถวว่างทั้ง
--      5 ช่องได้ (3j-migration-traps #13 เป๊ะ — ด่าน "มีแถวไหม" กับ "มีตัวเลขไหม"
--      คนละคำถาม) ⇒ ชั้นเขียนปฏิเสธถ้าไม่มีตัวเลขจริงเลย (0149 แก้ชั้นอ่านคู่กัน).
-- M1 — คอลัมน์ source (เดี่ยว) โกหกเมื่อแถวผสมสองแหล่ง (เช่น view จาก
--      tiktok_api ภายหลังมีคนเติม save มือ) ⇒ เพิ่ม sources text[] สะสมทุกแหล่ง
--      ที่เคยเขียนแถวนี้ ตัดสินใจตอนนี้เพราะตารางยังว่าง (ทำทีหลัง = ย้อนเดาที่มา
--      ของข้อมูลจริงไม่ได้อีกแล้ว).
-- L1 — วางลิงก์ซ้ำ (conflict) ทับโพสต์ที่ status='deleted'/'private' อัปเดตฟิลด์
--      อื่นเงียบๆ โดยสถานะยังค้าง ⇒ raise บอกให้เปิดกลับผ่าน content_post_set_status
--      ก่อน (ไม่ auto-reactivate เพราะ deleted อาจแปลว่าโพสต์ถูกลบจริงบน TikTok).
-- L2 — posted_at อนาคตรับเข้าได้ ⇒ โพสต์ถูกแช่แข็ง (เขียน metric ไม่ได้เลย)
--      ถาวรจนกว่าจะถึงวันนั้นจริง ⇒ raise ตั้งแต่ตอนสร้าง/แก้.
-- L3 — external_id ไม่มีเพดานความยาว ⇒ ใส่ check เหมือน post_url (500 ตัวอักษร).
-- L4 — เดิมตรวจความยาวจาก p_post_url ดิบ แต่ตรวจความว่างจาก btrim(p_post_url)
--      — คนละฐาน ⇒ ใช้ length(btrim(...)) ทั้งคู่ให้สอดคล้องกัน.
-- L7 — คอมเมนต์เดิมเขียนว่า "เขียนได้ทางเดียวคือผ่าน RPC" ซึ่งไม่จริง — ยืนยันสด
--      จาก pg_roles: service_role มี rolbypassrls=true (bypass RLS ได้เสมอ) ⇒
--      แก้คอมเมนต์ให้ตรงความจริง (RPC เป็นเส้นทางที่ตั้งใจ ไม่ใช่ด่านที่บล็อกได้จริง).
-- M5 — post_url ไม่ตรวจ scheme ⇒ javascript:/data: เข้า DB ได้ (วันนี้ยังไม่มีหน้าจอ
--      แต่ P3 จะทำ <a href={post_url}>) ⇒ เพิ่ม CHECK ต้องขึ้นต้น http(s)://
--      (ไม่บังคับว่า url ต้องตรง platform — short link เช่น vt.tiktok.com เป็น
--      use case จริง).
-- ============================================================================
--
-- ============================================================================
-- 🔴 ของจริงชนะบรีฟ — ยืนยันด้วย query สดวันนี้ (22 ก.ย. 69) ก่อนเขียนไฟล์นี้:
--
-- 1. Grant model: has_schema_privilege('authenticated','analytics','usage') = false,
--    ('anon', ...) = false, ('service_role', ...) = true — ยืนยันสดตรงกับที่บรีฟบอก
--    (0122→0123→0124 ปิด REST ทั้งสคีมาแล้ว) ⇒ ทุก table/function ใหม่ในไฟล์นี้
--    grant ให้ service_role อย่างเดียว ไม่มี `to authenticated` (3j-migration-traps #18) —
--    ต่างจากตัวอย่างเก่าในไฟล์ 0121 (ก่อน 0123) ที่ grant ให้ authenticated ด้วย
--    ห้ามลอกไฟล์นั้นมาใช้.
-- 2. ข้อมูลอ้างอิงที่ต้องคงเดิม: analytics.step_artifact = 65 แถว, analytics.campaign_step
--    = 55 แถว, analytics.content_type = 5 แถว, analytics.v_campaign_board = 55 แถว —
--    ไฟล์นี้ไม่แตะตารางเหล่านี้เลย (create table ใหม่ + alter ไม่มี) ดังนั้นตัวเลข
--    ต้องเท่าเดิมเป๊ะหลัง apply (verify T14).
-- 3. ไม่มีฟังก์ชัน analytics.content_post_upsert/content_post_metric_upsert/
--    content_post_set_status อยู่ก่อนแล้ว (query pg_proc สดยืนยันแล้ว) — `drop function
--    if exists` ด้านล่างเป็น defensive/idempotent pattern เท่านั้น ไม่ได้ล้าง overload จริง
--    ที่มีอยู่ (ตามธรรมเนียมไฟล์อื่นในโปรเจกต์ เช่น 0121).
-- 4. analytics.crm_require_owner_admin(uuid) มีอยู่แล้ว (0021) — ใช้ short-circuit
--    ให้ service_role ผ่านเสมอ (แอปยังกำหนดสิทธิ์ owner/admin เองที่ชั้น server action
--    จนกว่า auth เต็มรูปแบบ) และเช็ค shop_member.role in ('owner','admin') สำหรับ
--    caller ที่เป็น authenticated จริง — เรียกใช้ตัวเดิม ไม่เขียนซ้ำ.
-- 5. service_role.rolbypassrls = true (ยืนยันสดจาก pg_roles วันนี้) — ดู L7 ด้านบน
-- ============================================================================

-- ============================================================================
-- 1. analytics.content_post — 1 แถว = 1 โพสต์ × 1 แพลตฟอร์ม × 1 ครั้งที่ปล่อย
-- ============================================================================

create table analytics.content_post (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shop (id) on delete cascade,
  -- 🔴 nullable โดยตั้งใจ — เจ้าของโพสต์ของที่ไม่ได้อยู่ในปฏิทินแน่นอน ถ้าบังคับ
  -- ให้สร้างงานในปฏิทินก่อนถึงจะวางลิงก์ได้ ระบบจะถูกเลิกใช้ในสัปดาห์แรก
  artifact_id        uuid references analytics.step_artifact (id) on delete set null,
  platform           text not null,
  external_id        text not null,
  post_url           text not null,
  posted_at          timestamptz not null,
  -- 🔴 plain column ห้ามใส่ generated always as — (timestamptz at time zone text)
  -- เป็น STABLE ไม่ใช่ IMMUTABLE (3j-migration-traps #6 + Postgres ปฏิเสธ generated
  -- column ที่ไม่ immutable) ⇒ content_post_upsert คำนวณค่านี้เองแล้วเขียนลงไปตรงๆ
  posted_date_th     date not null,
  content_type_code  text references analytics.content_type (code),
  caption_snapshot   text,
  status             text not null default 'active',
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint content_post_platform_check check (platform in ('tiktok', 'facebook', 'instagram', 'line_oa')),
  constraint content_post_external_id_len_check check (length(external_id) <= 500),
  constraint content_post_url_len_check check (length(post_url) <= 500),
  -- M5: กัน javascript:/data: เข้า DB — ไม่บังคับ domain ให้ตรง platform (short
  -- link เช่น vt.tiktok.com เป็น use case จริง) แค่ต้องเป็น http(s) เท่านั้น
  constraint content_post_url_scheme_check check (post_url ~* '^https?://'),
  constraint content_post_status_check check (status in ('active', 'deleted', 'private')),
  constraint content_post_shop_platform_external_uq unique (shop_id, platform, external_id)
);

comment on table analytics.content_post is
  'ที่เก็บลิงก์โพสต์จริงที่ปล่อยแล้ว (1 แถว/โพสต์/แพลตฟอร์ม/ครั้งที่ปล่อย) — เขียนผ่าน '
  'analytics.content_post_upsert เป็นเส้นทางที่ตั้งใจ (validation ทั้งหมดอยู่ที่นั่น) '
  '🔴 แต่ service_role เขียนตรงบนตารางนี้ได้เสมอ (rolbypassrls=true, bypass RLS/RPC ทั้งชุด — '
  'ดูคอมเมนต์ policy ด้านล่าง). artifact_id เป็น null ได้ตั้งใจ (โพสต์นอกปฏิทิน '
  'ต้องวางลิงก์ได้เสมอ ไม่บังคับผ่านปฏิทินก่อน).';
comment on column analytics.content_post.artifact_id is
  'ผูกกับ analytics.step_artifact ถ้าโพสต์นี้มาจากงานในปฏิทิน — null = โพสต์นอกปฏิทิน '
  '(อนุญาตตั้งใจ, ดูคอมเมนต์หัวไฟล์ 0148).';
comment on column analytics.content_post.posted_date_th is
  'วันทางธุรกิจไทยที่ปล่อยโพสต์ (แปลงจาก posted_at ด้วย at time zone ''Asia/Bangkok'') — '
  'plain column เขียนโดย content_post_upsert เท่านั้น ห้ามทำเป็น generated column '
  '(at time zone เป็น STABLE ไม่ใช่ IMMUTABLE). แก้ posted_at ของโพสต์เดิม ⇒ '
  'content_post_metric.age_days ของแถวเก่าถูกคิดใหม่ให้อัตโนมัติ (H2, ดูฟังก์ชันด้านล่าง).';
comment on column analytics.content_post.status is
  '''active'' = ยังเก็บ metric ต่อ · ''deleted''/''private'' = โพสต์ถูกลบ/ตั้งส่วนตัวแล้ว '
  'หยุดเก็บ metric ใหม่ (ดู content_post_set_status) แต่ metric เก่าที่เก็บไว้แล้วไม่ถูกลบ. '
  '🔴 L1: วาง external_id เดิมซ้ำตอนสถานะไม่ใช่ active ⇒ content_post_upsert raise (ไม่ '
  'auto-reactivate) — ต้องเรียก content_post_set_status(..., ''active'') ก่อนเอง.';

create index idx_content_post_shop_posted on analytics.content_post (shop_id, posted_date_th desc);
create index idx_content_post_artifact on analytics.content_post (artifact_id) where artifact_id is not null;

drop trigger if exists trg_content_post_updated_at on analytics.content_post;
create trigger trg_content_post_updated_at
  before update on analytics.content_post
  for each row execute function public.set_updated_at();

alter table analytics.content_post enable row level security;

-- SELECT-only policy (defense-in-depth เผื่ออนาคต analytics ถูกเปิด REST อีกครั้ง —
-- วันนี้ GRANT/USAGE ระดับ schema ปิดอยู่แล้วตั้งแต่ 0123, policy นี้ไม่มีผลจริงในทาง
-- ปฏิบัติกับ authenticated/anon เพราะเข้า schema นี้ไม่ได้ตั้งแต่ต้น).
-- 🔴 L7 (security round 2): คอมเมนต์เดิมเคยเขียนว่า "เขียนได้ทางเดียวคือผ่าน RPC
-- เพราะเจ้าของฟังก์ชัน=postgres เป็นเจ้าของตารางด้วย ⇒ ไม่ถูก RLS บล็อก" — ไม่จริง/
-- โกหก (คอมเมนต์ที่โกหกแย่กว่าไม่มีคอมเมนต์). ยืนยันสดจาก pg_roles วันนี้:
-- service_role.rolbypassrls = true ⇒ service_role (server action ต่อตรง, script,
-- dashboard) เขียน/แก้/ลบตารางนี้ตรงได้เสมอ ไม่ว่า RLS policy จะเขียนว่าอะไร —
-- RPC ด้านล่างเป็น "เส้นทางที่ตั้งใจให้แอปใช้" (validation/business rule ทั้งหมด
-- อยู่ที่นั่น) ไม่ใช่ด่านที่บล็อกได้จริงในทางเทคนิค ผู้ที่ต่อด้วย service_role key
-- ตรงต้องรับผิดชอบ validation เอง.
drop policy if exists tenant_isolation_select on analytics.content_post;
create policy tenant_isolation_select on analytics.content_post
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

grant select on analytics.content_post to service_role;

-- ============================================================================
-- 2. analytics.content_post_metric — time-series 1 แถว/โพสต์/วันธุรกิจไทย
--
-- 🔴 save_count คือคอลัมน์ที่สำคัญที่สุดในตารางนี้ — TikTok Display API ไม่มีให้
-- แต่เจ้าของเห็นใน TikTok Studio และคนกดบันทึกมากกว่าแชร์ 3.5 เท่า (315 vs 91,
-- ตัวเลขจริงจากคลิปดังสุด @3jjewelry) — บันทึก = "อยากซื้อแต่ยังไม่ซื้อตอนนี้"
-- ใกล้เงินกว่าแชร์สำหรับร้านเครื่องประดับ.
--
-- 🔴 ทุกคอลัมน์นับเป็น bigint ที่ null ได้ และ null ≠ 0 — "ยังไม่ได้อ่าน" ไม่ใช่
-- "ศูนย์ครั้ง" ห้าม coalesce เป็น 0 ที่ชั้นไหนทั้งสิ้น (3j-migration-traps #13:
-- ด่านที่เช็คความว่างต้องพิสูจน์ก่อนว่าค่าจริงเป็น null ชนิดไหน — ที่นี่เป็น SQL
-- NULL ตรงๆ ไม่มีชั้น coalesce ระหว่างทางให้บิดเบือน).
-- ============================================================================

create table analytics.content_post_metric (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shop (id) on delete cascade,
  post_id        uuid not null references analytics.content_post (id) on delete cascade,
  captured_at    timestamptz not null default now(),
  captured_on    date not null,
  age_days       int not null,
  view_count     bigint,
  like_count     bigint,
  comment_count  bigint,
  save_count     bigint,
  share_count    bigint,
  source         text not null default 'manual',
  -- 🔴 M1 (security round 2): source (เดี่ยว) โกหกเมื่อแถวผสมสองแหล่ง เช่น
  -- view=50000 มาจาก tiktok_api แล้วมีคนเติม save=315 มือทีหลัง — source เดี่ยว
  -- จะบอกว่า 'manual' ทั้งที่ view ไม่ได้มาจากมือ sources สะสมทุกแหล่งที่เคยเขียน
  -- แถวนี้ (distinct+sort) ตัดสินใจเพิ่มตอนนี้เพราะตารางยังว่าง — รอทำทีหลังคือ
  -- migration+backfill ที่เดาที่มาของข้อมูลจริงย้อนหลังไม่ได้อีกแล้ว
  sources        text[] not null default array[]::text[],
  is_regression  boolean not null default false,
  raw            jsonb,
  constraint content_post_metric_age_check check (age_days >= 0),
  constraint content_post_metric_view_check check (view_count is null or view_count >= 0),
  constraint content_post_metric_like_check check (like_count is null or like_count >= 0),
  constraint content_post_metric_comment_check check (comment_count is null or comment_count >= 0),
  constraint content_post_metric_save_check check (save_count is null or save_count >= 0),
  constraint content_post_metric_share_check check (share_count is null or share_count >= 0),
  constraint content_post_metric_source_check check (source in ('manual', 'tiktok_api', 'backfill')),
  constraint content_post_metric_post_captured_uq unique (post_id, captured_on)
);

comment on table analytics.content_post_metric is
  'Time-series engagement ต่อโพสต์ต่อวันธุรกิจไทย (1 แถว/post_id/captured_on) — เขียนผ่าน '
  'analytics.content_post_metric_upsert เป็นเส้นทางที่ตั้งใจ (validation ทั้งหมดอยู่ที่นั่น) '
  '🔴 แต่ service_role เขียนตรงบนตารางนี้ได้เสมอ (rolbypassrls=true — ดูคอมเมนต์ '
  'content_post สำหรับรายละเอียด). ทุกคอลัมน์นับเป็น null ได้และ null ≠ 0 — '
  'ห้าม coalesce เป็น 0 ที่ชั้นไหนทั้งสิ้น. ตัวเลขถอยหลังไม่ถูกทับ (เก็บค่าดิบ + is_regression) '
  'ดูคอมเมนต์ is_regression ด้านล่างสำหรับรายละเอียด.';
comment on column analytics.content_post_metric.save_count is
  'บันทึก — TikTok Display API ไม่มีให้ (มีแค่ที่เห็นใน TikTok Studio) กรอกมือเป็นช่องทาง '
  'เดียวที่ได้ตัวเลขนี้ ไม่ใช่ของชั่วคราวที่จะทิ้งตอนต่อ API ในอนาคต — สัญญาณ "อยากซื้อแต่ยัง '
  'ไม่ซื้อ" ที่ API ให้ไม่ได้.';
comment on column analytics.content_post_metric.age_days is
  'captured_on − content_post.posted_date_th (วันธุรกิจไทยทั้งคู่) — เขียนครั้งแรกใน '
  'content_post_metric_upsert, คิดใหม่อัตโนมัติถ้า content_post_upsert แก้ posted_at ของ '
  'โพสต์เดิม (H2) ⇒ ติดลบไม่มีวันเกิด (ทั้งสองจุดกันไว้ก่อนเขียน/แก้).';
comment on column analytics.content_post_metric.source is
  '🔴 M1 (security round 2): แหล่งของ "การเขียนครั้งล่าสุด" เท่านั้น ไม่ใช่ของทั้งแถว — '
  'แถวผสมได้จากหลายแหล่ง (เช่น view จาก tiktok_api ภายหลังมีคนเติม save มือ) '
  'ดู sources สำหรับรายการแหล่งทั้งหมดที่เคยเขียนแถวนี้สะสม.';
comment on column analytics.content_post_metric.sources is
  'รายการทุกแหล่ง (distinct, sort) ที่เคยเขียนแถวนี้สะสมมาตั้งแต่แถวถูกสร้าง — ตัวเดียวที่ '
  'บอกได้ว่าแถวนี้ผสมมาจากกี่แหล่ง ต่างจาก source ที่บอกแค่ครั้งล่าสุด.';
comment on column analytics.content_post_metric.is_regression is
  'true = ค่าที่จะถูกเก็บจริง (หลังผสม null-preserving กับแถวเดิมของวันนี้ถ้ามี จาก '
  'content_post_metric_upsert) อย่างน้อย 1 คอลัมน์ ต่ำกว่าค่าสูงสุดของ "วันก่อนหน้าเท่านั้น" '
  '(captured_on < วันนี้) ของโพสต์นี้ (เช่น TikTok ปรับ view ลงจริง) — 🔴 H1 (security round 2): '
  'เทียบกับวันก่อนหน้าเท่านั้น ไม่รวมแถวของวันนี้เอง เพื่อ (1) กันธงถูกล้างเป็น false เมื่อยิงซ้ำ '
  'วันเดียวกันด้วยคอลัมน์อื่น (2) กัน false positive จากการแก้ตัวเลขผิดในวันเดียวกัน. '
  'ค่าดิบยังถูกเก็บตามที่ส่งมาเป๊ะ ไม่ clamp ด้วย greatest() (ถ้าทับ เราจะไม่มีวันรู้ว่ามันเกิด). '
  'ชั้นอ่านที่ต้องการเส้นไม่ถอยหลังให้ใช้ running max แทนค่าดิบ: max(view_count) over '
  '(partition by post_id order by age_days rows between unbounded preceding and current row) '
  '— ดูทดสอบ T12/T_H1 ใน scripts/verify-0148.sql.';
comment on column analytics.content_post_metric.raw is
  'payload ดิบจากแหล่งข้อมูล (สงวนไว้สำหรับ source=tiktok_api ใน P3) — RPC กรอกมือ (P2) '
  'ไม่เขียนคอลัมน์นี้ ปล่อย null เสมอ.';

create index idx_content_post_metric_post_age on analytics.content_post_metric (post_id, age_days);

alter table analytics.content_post_metric enable row level security;

drop policy if exists tenant_isolation_select on analytics.content_post_metric;
create policy tenant_isolation_select on analytics.content_post_metric
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

grant select on analytics.content_post_metric to service_role;

-- ============================================================================
-- 3. analytics.content_post_upsert
--
-- ตัดสินใจเองนอกบรีฟ: p_caption (caption_snapshot) ใช้ null-preserving pattern
-- เดียวกับ p_artifact_id/p_content_type_code แม้บรีฟจะพูดถึงแค่ 2 ตัวหลัง —
-- p_caption ก็เป็นพารามิเตอร์ default null เหมือนกัน หลักการเดียวกับบทเรียน 0144
-- ("ฟอร์มส่ง null แล้วทับค่าที่ตั้งไว้ทิ้งเงียบ") ใช้ได้กับทุกฟิลด์ optional ไม่ใช่
-- แค่ 2 ตัวที่บรีฟยกตัวอย่าง — ไม่ทำแบบนี้จะเปิดช่องเดียวกันซ้ำ.
-- ============================================================================

drop function if exists analytics.content_post_upsert(uuid, text, text, text, timestamptz, text, uuid, text);

create function analytics.content_post_upsert(
  p_shop_id uuid,
  p_platform text,
  p_external_id text,
  p_post_url text,
  p_posted_at timestamptz,
  p_content_type_code text default null,
  p_artifact_id uuid default null,
  p_caption text default null
) returns uuid
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_posted_date_th date;
  v_post_id uuid;
  v_existing_id uuid;
  v_existing_status text;
  v_old_posted_date_th date;
  v_negative_age_count int;
begin
  if p_shop_id is null or p_platform is null or p_external_id is null
     or p_post_url is null or p_posted_at is null then
    raise exception 'content_post_upsert: p_shop_id, p_platform, p_external_id, p_post_url, p_posted_at เป็นค่าจำเป็น';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);  -- ด่านสิทธิ์ก่อน validate อื่น (กัน probe)

  -- เช็คซ้ำกับ CHECK ของตารางโดยตั้งใจ — error message อ่านรู้เรื่องกว่า constraint violation ดิบ
  if p_platform not in ('tiktok', 'facebook', 'instagram', 'line_oa') then
    raise exception 'content_post_upsert: platform ไม่ถูกต้อง: %', p_platform using errcode = '22023';
  end if;

  -- 🔴 L4 (security round 2): ตรวจความว่าง/ความยาวจากฐานเดียวกัน (btrim แล้ว)
  -- ของเดิมตรวจความว่างจาก btrim(...) แต่ตรวจความยาวจาก p_post_url ดิบ — คนละฐาน
  if length(btrim(p_external_id)) = 0 then
    raise exception 'content_post_upsert: p_external_id ห้ามเป็นค่าว่าง' using errcode = '22023';
  end if;
  -- 🔴 L3: external_id ไม่เคยมีเพดานความยาวมาก่อน — ใส่ให้เหมือน post_url
  if length(btrim(p_external_id)) > 500 then
    raise exception 'content_post_upsert: p_external_id ยาวเกิน 500 ตัวอักษร' using errcode = '22023';
  end if;

  if length(btrim(p_post_url)) = 0 then
    raise exception 'content_post_upsert: p_post_url ห้ามเป็นค่าว่าง' using errcode = '22023';
  end if;

  if length(btrim(p_post_url)) > 500 then
    raise exception 'content_post_upsert: p_post_url ยาวเกิน 500 ตัวอักษร' using errcode = '22023';
  end if;

  -- 🔴 M5: กัน javascript:/data: เข้า DB (วันนี้ยังไม่มีหน้าจอ แต่ P3 จะทำ
  -- <a href={post_url}> แล้วไม่มีใครย้อนมาอ่าน migration นี้อีก) — ไม่บังคับว่า
  -- domain ต้องตรง platform (short link เช่น vt.tiktok.com เป็น use case จริง)
  if btrim(p_post_url) !~* '^https?://' then
    raise exception 'content_post_upsert: p_post_url ต้องขึ้นต้นด้วย http:// หรือ https:// (ได้รับ: %)', p_post_url using errcode = '22023';
  end if;

  -- 🔴 L2: โพสต์อนาคตรับเข้าได้ ⇒ content_post_metric_upsert จะ raise (age_days
  -- ติดลบ) ทุกครั้งจนกว่าจะถึงวันนั้นจริง — โพสต์ถูกแช่แข็งถาวรเปล่าๆ กันตั้งแต่ตรงนี้
  if p_posted_at > now() then
    raise exception 'content_post_upsert: posted_at (%) อยู่ในอนาคต — ยังบันทึกไม่ได้จนกว่าจะถึงเวลานั้นจริง', p_posted_at using errcode = '22023';
  end if;

  if p_artifact_id is not null and not exists (
    select 1 from analytics.step_artifact where id = p_artifact_id and shop_id = p_shop_id
  ) then
    raise exception 'content_post_upsert: ไม่พบ artifact % ในร้านนี้', p_artifact_id using errcode = '22023';
  end if;

  if p_content_type_code is not null and not exists (
    select 1 from analytics.content_type where code = p_content_type_code
  ) then
    raise exception 'content_post_upsert: content_type_code ไม่ถูกต้อง: %', p_content_type_code using errcode = '22023';
  end if;

  -- เขตเวลาไทย (3j-migration-traps #6) — วันทางธุรกิจของโพสต์ ไม่ใช่วันที่ UTC
  v_posted_date_th := (p_posted_at at time zone 'Asia/Bangkok')::date;

  -- ล็อกแถวเดิม (ถ้ามี) + อ่านสถานะ/วันโพสต์เดิมไว้ก่อน upsert (ใช้ตัดสิน L1/H2
  -- ด้านล่าง — ต้องอ่าน "ก่อน" upsert เพราะ upsert จะทับ posted_date_th ไปแล้ว)
  select id, status, posted_date_th into v_existing_id, v_existing_status, v_old_posted_date_th
  from analytics.content_post
  where shop_id = p_shop_id and platform = p_platform and external_id = btrim(p_external_id)
  for update;

  -- 🔴 L1 (security round 2): โพสต์เดิมถูกตั้งเป็น deleted/private แล้ว ห้าม
  -- อัปเดตฟิลด์อื่น (post_url ฯลฯ) เงียบๆ โดยสถานะยังค้าง — ต้องให้คนสั่งเปิดกลับ
  -- เองผ่าน content_post_set_status ก่อน (ไม่ auto-reactivate เพราะ deleted อาจ
  -- แปลว่าโพสต์ถูกลบจริงบน TikTok ไม่ใช่แค่ตั้งค่าในระบบเราผิด)
  if v_existing_id is not null and v_existing_status <> 'active' then
    raise exception 'content_post_upsert: โพสต์นี้ (id=%) มีสถานะ ''%'' อยู่แล้ว — ถ้าต้องการเปิดกลับมาเก็บ metric ต่อ ให้เรียก content_post_set_status(..., ''active'') ก่อน แล้วค่อยเรียกซ้ำ',
      v_existing_id, v_existing_status using errcode = '22023';
  end if;

  -- 🔴 H2 (security round 2): แก้วันโพสต์ (posted_at) ของโพสต์เดิม ⇒ metric ที่
  -- บันทึกไปแล้วอายุจะเปลี่ยน — กันก่อนว่าจะไม่เกิด age_days ติดลบย้อนหลัง
  -- (แถวที่ captured_on มาก่อนวันโพสต์ใหม่) ก่อนจะยอมให้แก้
  if v_existing_id is not null and v_old_posted_date_th is distinct from v_posted_date_th then
    select count(*) into v_negative_age_count
    from analytics.content_post_metric
    where post_id = v_existing_id and captured_on < v_posted_date_th;

    if v_negative_age_count > 0 then
      raise exception 'content_post_upsert: แก้วันโพสต์เป็น % จะทำให้ metric % แถวมี age_days ติดลบ (captured_on ก่อนวันโพสต์ใหม่) — แก้วันที่นี้ไม่ได้',
        v_posted_date_th, v_negative_age_count using errcode = '22023';
    end if;
  end if;

  insert into analytics.content_post as cp (
    shop_id, artifact_id, platform, external_id, post_url, posted_at, posted_date_th,
    content_type_code, caption_snapshot, created_by
  )
  values (
    p_shop_id, p_artifact_id, p_platform, btrim(p_external_id), btrim(p_post_url), p_posted_at, v_posted_date_th,
    p_content_type_code, nullif(btrim(coalesce(p_caption, '')), ''), auth.uid()
  )
  on conflict (shop_id, platform, external_id) do update
    set post_url          = excluded.post_url,
        posted_at          = excluded.posted_at,
        posted_date_th     = excluded.posted_date_th,
        -- 🔴 null = ไม่แตะ ⇒ คงค่าที่แถวเดิมมีอยู่ก่อน UPDATE นี้ (อ้างผ่าน alias
        -- ของตารางเป้าหมาย `cp.x` ไม่ใช่ `excluded.x` — trap #14/0144: excluded.x
        -- ตอน null คือ null เสมอ ไม่ใช่ค่าเดิมของแถว)
        artifact_id        = case when p_artifact_id is null then cp.artifact_id else p_artifact_id end,
        content_type_code  = case when p_content_type_code is null then cp.content_type_code else p_content_type_code end,
        caption_snapshot   = case when p_caption is null then cp.caption_snapshot else nullif(btrim(p_caption), '') end,
        updated_at         = now()
  returning id into v_post_id;

  -- 🔴 H2: คิด age_days ของ metric เดิมใหม่ตามวันโพสต์ที่แก้ (3j-migration-traps
  -- #19: แคบ where เหลือเฉพาะแถวที่ค่าเปลี่ยนจริง — ตารางนี้ยังไม่มี trigger
  -- updated_at ก็ทำให้ถูกไว้ เผื่ออนาคตมีคนเพิ่ม)
  if v_existing_id is not null and v_old_posted_date_th is distinct from v_posted_date_th then
    update analytics.content_post_metric as m
    set age_days = m.captured_on - v_posted_date_th
    where m.post_id = v_post_id
      and m.age_days <> (m.captured_on - v_posted_date_th);
  end if;

  return v_post_id;
end;
$$;

comment on function analytics.content_post_upsert(uuid, text, text, text, timestamptz, text, uuid, text) is
  'เส้นทางที่ตั้งใจให้เขียน analytics.content_post (validation ทั้งหมดอยู่ที่นี่ — ดูคอมเมนต์ '
  'ตารางเรื่อง service_role bypass) — upsert บน (shop_id, platform, external_id). '
  'p_artifact_id/p_content_type_code/p_caption เป็น null-preserving เมื่อ conflict (ไม่ทับค่าเดิมถ้า '
  'ผู้เรียกส่ง null มา, 3j-migration-traps #14). แก้ posted_at ของโพสต์เดิม ⇒ recompute '
  'content_post_metric.age_days ให้อัตโนมัติ (H2) — ปฏิเสธถ้าจะทำให้ age_days ติดลบ. '
  'ปฏิเสธถ้าโพสต์เดิมสถานะไม่ใช่ active (L1) หรือ posted_at อยู่ในอนาคต (L2).';

revoke execute on function analytics.content_post_upsert(uuid, text, text, text, timestamptz, text, uuid, text)
  from public, anon, authenticated;
grant execute on function analytics.content_post_upsert(uuid, text, text, text, timestamptz, text, uuid, text)
  to service_role;

-- ============================================================================
-- 4. analytics.content_post_metric_upsert
--
-- ตัดสินใจเองนอกบรีฟ: p_view/p_like/p_comment/p_save/p_share ก็ใช้ null-preserving
-- pattern เดียวกับข้อ 3 ด้านบน — เหตุผลจริง: source='tiktok_api' (สงวนไว้ P3) จะไม่มี
-- save_count เลย (TikTok Display API ไม่ให้) ถ้าเรียก RPC เดียวกันนี้วันเดียวกับที่
-- มีคนกรอกมือ save_count ไว้แล้ว การ overwrite เป็น null ตรงๆ จะลบข้อมูลที่เพิ่งกรอกทิ้ง
-- เงียบๆ — null-preserving กันเคสนี้ได้ฟรีโดยไม่ต้องรู้ล่วงหน้าว่าใครเรียกก่อนหลัง.
-- ============================================================================

drop function if exists analytics.content_post_metric_upsert(uuid, uuid, bigint, bigint, bigint, bigint, bigint, text);

create function analytics.content_post_metric_upsert(
  p_shop_id uuid,
  p_post_id uuid,
  p_view bigint default null,
  p_like bigint default null,
  p_comment bigint default null,
  p_save bigint default null,
  p_share bigint default null,
  p_source text default 'manual'
) returns uuid
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_post analytics.content_post%rowtype;
  v_captured_on date;
  v_age_days int;
  v_existing analytics.content_post_metric%rowtype;
  v_final_view bigint;
  v_final_like bigint;
  v_final_comment bigint;
  v_final_save bigint;
  v_final_share bigint;
  v_prev_max_view bigint;
  v_prev_max_like bigint;
  v_prev_max_comment bigint;
  v_prev_max_save bigint;
  v_prev_max_share bigint;
  v_is_regression boolean;
  v_metric_id uuid;
begin
  if p_shop_id is null or p_post_id is null then
    raise exception 'content_post_metric_upsert: p_shop_id, p_post_id เป็นค่าจำเป็น';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_source not in ('manual', 'tiktok_api', 'backfill') then
    raise exception 'content_post_metric_upsert: source ไม่ถูกต้อง: %', p_source using errcode = '22023';
  end if;

  -- 🔴 H3 (security round 2, = 3j-migration-traps #13 เป๊ะ): ต้องมีตัวเลขจริง
  -- อย่างน้อย 1 ค่า ห้ามเรียกเฉยๆ สร้างแถวว่างทั้ง 5 ช่อง — แถวว่างทำให้
  -- v_content_entry_queue (0149) คิดว่า "อ่านแล้ว" ทั้งที่ไม่มีตัวเลขจริงเลย
  -- แล้วโพสต์หลุดออกจากคิวถาวร (ชั้นอ่านของ 0149 กันซ้ำอีกชั้นสำหรับแถวเก่า/
  -- backfill ที่ไม่ผ่าน RPC นี้)
  if num_nonnulls(p_view, p_like, p_comment, p_save, p_share) = 0 then
    raise exception 'content_post_metric_upsert: ต้องส่งตัวเลขจริงอย่างน้อย 1 ค่า (view/like/comment/save/share) ห้ามเรียกแบบไม่มีค่าอะไรเลย' using errcode = '22023';
  end if;

  -- ตัวเลขนับติดลบไม่มีความหมาย (bigint ปลอดภัยจาก NaN/Infinity อยู่แล้ว —
  -- 3j-migration-traps #4 เตือนแค่ numeric, cast ของ bigint พังเองตั้งแต่ parameter)
  if p_view is not null and p_view < 0 then
    raise exception 'content_post_metric_upsert: view_count ติดลบไม่ได้' using errcode = '22023';
  end if;
  if p_like is not null and p_like < 0 then
    raise exception 'content_post_metric_upsert: like_count ติดลบไม่ได้' using errcode = '22023';
  end if;
  if p_comment is not null and p_comment < 0 then
    raise exception 'content_post_metric_upsert: comment_count ติดลบไม่ได้' using errcode = '22023';
  end if;
  if p_save is not null and p_save < 0 then
    raise exception 'content_post_metric_upsert: save_count ติดลบไม่ได้' using errcode = '22023';
  end if;
  if p_share is not null and p_share < 0 then
    raise exception 'content_post_metric_upsert: share_count ติดลบไม่ได้' using errcode = '22023';
  end if;

  select * into v_post from analytics.content_post where id = p_post_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_post_metric_upsert: ไม่พบโพสต์ % ในร้านนี้', p_post_id using errcode = '22023';
  end if;

  -- เขตเวลาไทย (3j-migration-traps #6) — "วันนี้" ของการอ่านค่า ไม่ใช่ current_date (UTC)
  v_captured_on := (now() at time zone 'Asia/Bangkok')::date;
  v_age_days := v_captured_on - v_post.posted_date_th;

  -- 🔴 age_days ติดลบ = โพสต์อนาคต ⇒ raise ไม่ใช่เก็บ (บรีฟข้อ 6)
  if v_age_days < 0 then
    raise exception 'content_post_metric_upsert: age_days ติดลบ (%) — โพสต์ % ปล่อยวันที่ในอนาคต (posted_date_th=%, วันนี้=%)',
      v_age_days, p_post_id, v_post.posted_date_th, v_captured_on using errcode = '22023';
  end if;

  -- 🔴 H1 (security round 2): อ่านแถวของวันนี้ (ถ้ามี จาก upsert ซ้ำก่อนหน้าใน
  -- วันเดียวกัน) มาผสมแบบ null-preserving ก่อน — ต้องรู้ "ค่าสุดท้ายที่จะถูกเก็บ
  -- จริง" ก่อนตัดสิน is_regression ไม่ใช่ตัดสินจาก p_view/p_like/... ดิบที่ส่งมา
  -- รอบนี้ (ของเดิมทำแบบนั้น ⇒ ยิงซ้ำด้วยคอลัมน์อื่นแล้วธงถูกล้างเป็น false)
  select * into v_existing from analytics.content_post_metric
  where post_id = p_post_id and captured_on = v_captured_on
  for update;

  v_final_view    := coalesce(p_view, v_existing.view_count);
  v_final_like    := coalesce(p_like, v_existing.like_count);
  v_final_comment := coalesce(p_comment, v_existing.comment_count);
  v_final_save    := coalesce(p_save, v_existing.save_count);
  v_final_share   := coalesce(p_share, v_existing.share_count);

  -- เทียบค่าสุดท้ายที่จะเก็บกับค่าสูงสุดของ "วันก่อนหน้าเท่านั้น" (captured_on <
  -- วันนี้) — ไม่รวมแถวของวันนี้เอง 2 เหตุผล: (1) ปิดบั๊ก H1 ที่ธงถูกล้างเป็น
  -- false เมื่อยิงซ้ำวันเดียวกันด้วยคอลัมน์อื่น (2) ปิด false positive — แก้
  -- ตัวเลขผิดวันเดียวกัน (เช่น พิมพ์ 200 พลาดแล้วแก้เป็น 120) ไม่ใช่ "การถดถอยจริง"
  select max(view_count), max(like_count), max(comment_count), max(save_count), max(share_count)
  into v_prev_max_view, v_prev_max_like, v_prev_max_comment, v_prev_max_save, v_prev_max_share
  from analytics.content_post_metric
  where post_id = p_post_id and captured_on < v_captured_on;

  v_is_regression :=
    (v_final_view is not null and v_prev_max_view is not null and v_final_view < v_prev_max_view)
    or (v_final_like is not null and v_prev_max_like is not null and v_final_like < v_prev_max_like)
    or (v_final_comment is not null and v_prev_max_comment is not null and v_final_comment < v_prev_max_comment)
    or (v_final_save is not null and v_prev_max_save is not null and v_final_save < v_prev_max_save)
    or (v_final_share is not null and v_prev_max_share is not null and v_final_share < v_prev_max_share);

  insert into analytics.content_post_metric as m (
    shop_id, post_id, captured_at, captured_on, age_days,
    view_count, like_count, comment_count, save_count, share_count,
    source, sources, is_regression
  )
  values (
    p_shop_id, p_post_id, now(), v_captured_on, v_age_days,
    v_final_view, v_final_like, v_final_comment, v_final_save, v_final_share,
    p_source, array[p_source], v_is_regression
  )
  on conflict (post_id, captured_on) do update
    set captured_at    = now(),
        age_days       = excluded.age_days,
        -- ค่าที่ insert ไว้ (v_final_*) ผ่าน merge แบบ null-preserving มาแล้วตั้งแต่
        -- ก่อนหน้านี้ ⇒ ตรงนี้ set ตรงๆ ได้เลย ไม่ต้อง case-when ซ้ำ
        view_count     = excluded.view_count,
        like_count     = excluded.like_count,
        comment_count  = excluded.comment_count,
        save_count     = excluded.save_count,
        share_count    = excluded.share_count,
        source         = excluded.source,
        -- 🔴 M1: สะสมทุกแหล่งที่เคยเขียนแถวนี้ (distinct+sort) — source เดี่ยว
        -- ด้านบนเป็นแค่ "แหล่งของการเขียนครั้งล่าสุด" ไม่ใช่ของทั้งแถว
        sources        = (select array_agg(distinct s order by s) from unnest(m.sources || excluded.source) as s),
        is_regression  = excluded.is_regression
  returning id into v_metric_id;

  return v_metric_id;
end;
$$;

comment on function analytics.content_post_metric_upsert(uuid, uuid, bigint, bigint, bigint, bigint, bigint, text) is
  'ทางเดียวที่ตั้งใจให้เขียน analytics.content_post_metric — upsert บน (post_id, '
  'captured_on=วันนี้ไทย). ต้องมีตัวเลขจริงอย่างน้อย 1 ค่า (H3, ห้ามแถวว่าง). '
  'age_days ติดลบ raise ไม่เก็บ. is_regression=true เมื่อ "ค่าหลังผสม null-preserving" '
  'ต่ำกว่าค่าสูงสุดของวันก่อนหน้าเท่านั้น (H1) — ค่าดิบยังถูกเก็บตามที่ส่งเป๊ะ ไม่ clamp. '
  'sources สะสมทุกแหล่งที่เคยเขียนแถวนี้ (M1).';

revoke execute on function analytics.content_post_metric_upsert(uuid, uuid, bigint, bigint, bigint, bigint, bigint, text)
  from public, anon, authenticated;
grant execute on function analytics.content_post_metric_upsert(uuid, uuid, bigint, bigint, bigint, bigint, bigint, text)
  to service_role;

-- ============================================================================
-- 5. analytics.content_post_set_status — โพสต์ถูกลบ/ตั้งเป็นส่วนตัว ⇒ หยุดเก็บ
--    metric ใหม่ แต่ไม่ลบ metric เก่า (ไม่แตะ content_post_metric เลย)
-- ============================================================================

drop function if exists analytics.content_post_set_status(uuid, uuid, text);

create function analytics.content_post_set_status(
  p_shop_id uuid,
  p_post_id uuid,
  p_status text
) returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if p_shop_id is null or p_post_id is null or p_status is null then
    raise exception 'content_post_set_status: p_shop_id, p_post_id, p_status เป็นค่าจำเป็น';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_status not in ('active', 'deleted', 'private') then
    raise exception 'content_post_set_status: status ไม่ถูกต้อง: %', p_status using errcode = '22023';
  end if;

  update analytics.content_post as cp
  set status = p_status,
      updated_at = now()
  where cp.id = p_post_id and cp.shop_id = p_shop_id;

  if not found then
    raise exception 'content_post_set_status: ไม่พบโพสต์ % ในร้านนี้', p_post_id using errcode = '22023';
  end if;
end;
$$;

comment on function analytics.content_post_set_status(uuid, uuid, text) is
  'เปลี่ยนสถานะโพสต์ (active/deleted/private) — ไม่แตะ analytics.content_post_metric เลย '
  '(metric เก่ายังอยู่ครบ, ดูคอมเมนต์ content_post.status). L1: เป็นทางเดียวที่เปิดโพสต์ '
  'deleted/private กลับเป็น active ได้ (content_post_upsert ปฏิเสธเมื่อสถานะไม่ใช่ active).';

revoke execute on function analytics.content_post_set_status(uuid, uuid, text) from public, anon, authenticated;
grant execute on function analytics.content_post_set_status(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
