-- 0158_content_signal_hook_host.sql  (ก้อน C1 ของ workflow content/แคมเปญชุดใหม่)
--
-- สถานะ: ผ่าน security รอบ 2 (GO) + QA รอบ 2 + code review (6 ต.ค. 69) · apply ด้วย
-- `node scripts/run-sql.mjs --commit --record` แล้วรัน scripts/check-analytics-grants.sql +
-- scripts/verify/verify-0158.sql
--
-- Why: เจ้าของต้องการกล่องสัญญาณ (คลิปอ้างอิง/เทรนด์/คำถามไลฟ์/โมเมนต์ช่าง/บทเรียน) ที่ "คนหยิบ
-- ไม่ใช่ AI ไหลเข้า" + คลัง hook ที่ rollup ต่อประเภทได้ + โฮสต์ไลฟ์เป็น entity (F5: +161% มาจาก
-- โฮสต์ ไม่ใช่คลิป ⇒ ต้อง group by ได้ — text พิมพ์ต่าง 1 ตัวอักษร = คนละคน).
-- Design: docs/3j-jewelry/analytics/design-content-workflow-schema-gap.md §0.2 · §5.1 · §5.2 · §5.4 ·
-- §7.1 · §9.1 (architect 6 ต.ค. 69 ยืนยันกับ DB สดแล้ว) — ของจริงชนะเอกสารเสมอ: backend-dev รัน
-- query ชุด §0 ซ้ำก่อนเขียน ตัวเลขตรง (step 50 · artifact 53 · content_post 10 · live 3 · hooks 26 ·
-- shop 1 · live_session_upsert 1 signature) ไม่มีส่วนใดต่างจาก §0.2
--
-- ทำอะไร (additive เกือบทั้งหมด):
--   1. analytics.live_host            — โฮสต์ไลฟ์ (display_name ชื่อจริงภายใน · public_label ป้ายขึ้นจอ)
--   2. live_session_log.host_id       — nullable · composite FK (shop_id, host_id) กันโฮสต์ข้ามร้านที่ DB
--   3. analytics.content_signal       — 5 kind รวมคลิปอ้างอิง · unique (shop_id, url_norm)
--   4. analytics.content_hook         — hook เป็นแถว (ของเราต่อ step · ของเขาถอดโครงจากสัญญาณ)
--   5. live_session_upsert v2         — drop signature เดิมก่อน (trap #1) · เพิ่ม p_host_id /
--                                       p_questions / p_actor_role ท้ายสุดเป็น default ⇒ แอปเดิมเรียกได้
--   6. RPC: content_signal_capture · content_signal_set_status · content_hook_upsert ·
--           live_host_upsert (+ helper content_url_ok · content_text_clean · content_actor_assert · content_url_norm)
--   7. view ใหม่: v_content_signal · v_live_log_recent (ไม่แตะ view เดิมเลย — trap #3)
--   8. backfill: hook 26 แถวจาก step_artifact.clip_brief.hooks[] (INSERT ตารางใหม่เท่านั้น —
--      ไม่ UPDATE step_artifact ⇒ clip_brief jsonb เดิมไม่ถูกแตะ · trap #19 ไม่เกี่ยว)
--   9. seed live_host 2 แถว (§9.1 Q1) · shop_id query ตอน apply ไม่ hardcode
--
-- ⚠️ ชื่อจริงของโฮสต์ (display_name) ถูกเขียนลงไฟล์ migration นี้ตามมติเจ้าของ §9.1 Q1 ⇒ ไฟล์นี้
-- เป็น "ภายในทีม" — ห้ามคัดลอกชื่อไปใส่ brief สาธารณะ/ส่งออกนอกทีม · จอทั่วไปใช้ public_label
--
-- ตัดสินใจเองนอก design (เหตุผลอยู่ที่จุดนั้นในไฟล์ + สรุปส่งมอบ):
--   D-a  ไม่ทำ content_signal_pick ใน C1 — ต้องเขียน campaign_step.piece_status/piece_kind ซึ่งยังไม่มี
--        จนกว่า C2 (design §7 วาง pick ไว้ C1 แต่ DDL ของ pick พึ่งคอลัมน์ C2) ⇒ ย้ายไป C2
--   D-b  actor_role ต่อ RPC: capture/hook_upsert = owner|ai|system · set_status/live_host_upsert/
--        live_session_upsert = owner|system (AI เสนอสัญญาณได้ แต่ตัดสิน "ไม่ใช้/เก็บไว้" · สร้างคนในระบบ ·
--        เขียนบันทึกหลังไลฟ์ ไม่ได้ — security S-M2)
--   D-c  host_id ใน live_session_upsert: ค่า null ไม่ทับค่าเดิม (แนวเดียวกับ 0111 "ว่างห้ามทับ" —
--        แอปเดิมไม่ส่ง p_host_id ต้องไม่ล้างโฮสต์ที่เจ้าของเลือกไว้) ⇒ ล้างโฮสต์ผ่าน RPC นี้ไม่ได้
--   D-d  url_norm: ตัด scheme/www./m./fragment/trailing slash + เก็บ query เฉพาะ v · story_fbid ·
--        fbid · id (ไม่ตัด query ทั้งก้อนอย่างที่ design เขียน — YouTube watch?v= กับ Facebook
--        ?v=/?fbid= ใช้ query เป็นตัวระบุคลิป ตัดทิ้ง = ลิงก์คนละคลิปชนกันเป็น "ซ้ำ")
--        + เฉพาะ segment handle (ขึ้นต้น @) ของ host tiktok.com เป็นตัวเล็ก — /t/<code> ลิงก์สั้น · video id ·
--        host อื่น (YouTube video id ฯลฯ) case-sensitive ห้ามแตะ
--   D-e  live_host unique ทั้งชื่อและ public_label (ต่อร้าน · ไม่สนตัวพิมพ์) — ป้าย "โฮสต์ A" ซ้ำ
--        บนจอ = อ่านผลผิดคน
--   D-f  origin_post_id/origin_campaign_id = NO ACTION (ไม่ set null) เพราะ CHECK ของ insight
--        บังคับต้องมี origin อย่างน้อยหนึ่งอย่าง · picked_step_id = set null (ลบ step ได้ปกติ)
--
-- Grant model (3j-migration-traps #18): analytics ปิด REST ของ anon/authenticated ทั้งสคีมา (0123) ⇒
-- ทุก object ใหม่ grant ให้ service_role อย่างเดียว · revoke ทั้ง public + anon + authenticated ·
-- เขียนผ่าน RPC security definer เท่านั้น · หลัง apply รัน scripts/check-analytics-grants.sql
--
-- 🔴 actor_role มาจากแอป ไม่ใช่ auth (design R14 / D3): service_role ยังเป็นผู้เรียกเดียวของทุก RPC
-- ⇒ DB กัน "เส้นทาง AI" ได้ (agent ส่ง 'ai' เสมอ) แต่กันคนปลอมส่ง 'owner' ไม่ได้จนกว่า A2
--
-- ไฟล์นี้ idempotent — รันซ้ำได้ (ตรวจแล้วด้วยการรันซ้ำสองรอบติดกันในทรานแซกชันเดียว)
--
-- 🔴 ห้ามรันนอก `node scripts/run-sql.mjs` (ต้องรันทั้งไฟล์ใน transaction เดียว): ด่านท้ายไฟล์เทียบกับ snapshot ที่
-- section 0 เก็บไว้ใน GUC ระดับทรานแซกชัน — วางทีละก้อนใน SQL editor (autocommit) แล้ว snapshot หาย ⇒ ด่านท้าย
-- raise ทันที (ตั้งใจ: ไม่ปล่อยให้ "ไม่มีอะไรให้เทียบ" ผ่านเป็นเขียว)
--
-- ทำไมด่านถึงเข้มเท่านี้ (ประวัติรอบแก้อยู่ใน git — ที่นี่เก็บเฉพาะเหตุผล):
--   ลิงก์        : ตัวอ่านคนเห็นโดเมนหนึ่งแต่ไปอีกโดเมน (userinfo `good.com@evil.com` · RLO · ZWSP) ⇒ ปฏิเสธทั้งลิงก์
--                  ไม่ตัดแก้เงียบๆ · content_url_ok เป็นด่านเดียวที่ CHECK ตาราง · norm · capture เรียกร่วมกัน
--   ข้อความ      : ช่องที่ AI เขียนได้และขึ้นจอ (summary · hook · why_it_works · account · ชื่อ/ป้ายโฮสต์ ฯลฯ) ผ่าน
--                  content_text_clean ทุกช่อง ⇒ ไม่มีอักขระล่องหน/กลับทิศ · ว่างหลังลบ = ถูกปฏิเสธหรือเป็น null
--   สิทธิ์ AI    : AI เสนอสัญญาณ/hook ได้ แต่ตัดสินสถานะ · ทับ hook ที่คนเขียน · สร้างโฮสต์ · เขียนบันทึกไลฟ์ ไม่ได้ ·
--                  ป้าย A/B ซ้ำต้องส่ง p_id (กันทับ hook ที่เจ้าของเลือกไว้โดยไม่รู้ตัว)
--   ด่านท้ายไฟล์ : snapshot หาย = raise (ไม่ให้ "ไม่มีอะไรให้เทียบ" ผ่านเป็นเขียว) · ACL ใช้ coalesce(proacl, acldefault)
--   view         : v_live_log_recent เปิดเฉพาะ public_label — ชื่อจริงโฮสต์ไม่อยู่ใน view ที่จอทั่วไปอ่าน (กันด้วยโครงสร้าง)
--   norm         : lowercase เฉพาะ segment @handle ของ tiktok.com (/t/<code> และ id อื่น case-sensitive)
--   content_url_ok ถูกใช้ใน CHECK ⇒ แก้ตัวฟังก์ชันแล้วต้องตรวจแถวเดิมซ้ำ · ห้าม drop ... cascade (CHECK หายเงียบ)

-- ============================================================================
-- 0. snapshot ก่อนแตะอะไร — ใช้เทียบตอนท้ายไฟล์ ("ของเดิมต้องไม่ขยับ")
--    เก็บใน GUC ระดับทรานแซกชัน (set_config ... true) ไม่ใช้ temp table: รันซ้ำในทรานแซกชันเดียวได้
-- ============================================================================

do $c1snap$
begin
  perform set_config('c1.snap_live', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, shop_id, live_date, started_at, ended_at,
             peak_viewers, note, source, created_by, updated_by, created_at, updated_at), E'\n' order by id), ''))
    from analytics.live_session_log), true);
  perform set_config('c1.snap_artifact', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, status, content_body,
             clip_brief::text, updated_at), E'\n' order by id), ''))
    from analytics.step_artifact), true);
  perform set_config('c1.snap_step', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), E'\n' order by id), ''))
    from analytics.campaign_step), true);
  perform set_config('c1.snap_post', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), E'\n' order by id), ''))
    from analytics.content_post), true);
  -- view เดิมทุกตัว (ยกเว้น 2 ตัวใหม่ของไฟล์นี้) ต้อง definition เดิมเป๊ะ — trap #3 / R6
  perform set_config('c1.snap_views', (
    select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    from pg_class c
    where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v'
      and c.relname not in ('v_content_signal', 'v_live_log_recent')), true);
  -- ฟังก์ชันเดิมทุกตัวที่ไม่ใช่ของไฟล์นี้ต้อง definition เดิม (ไม่มีใครถูก replace ข้างเคียง)
  perform set_config('c1.snap_funcs', (
    select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
             order by p.oid::regprocedure::text), ''))
    from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
      and p.proname !~ '^(content_signal_|content_hook_|content_actor_|content_text_|content_url_|live_host_|live_session_upsert$)'), true);
end
$c1snap$;

-- ============================================================================
-- 1. analytics.live_host
--    ทำไม entity ไม่ใช่ text: ผลไลฟ์ต้อง group by โฮสต์ได้ (design §5.4) · เก็บทั้งชื่อจริงและป้ายขึ้นจอ
--    (§9 Q1: ชื่อขึ้นจอหรือไม่ ไม่บล็อกการสร้างตาราง — UI เลือกใช้ public_label ได้ทันที)
-- ============================================================================

create table if not exists analytics.live_host (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shop (id) on delete cascade,
  display_name  text not null,
  public_label  text not null,
  is_active     boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null,
  updated_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- เป้าของ composite FK จาก live_session_log (กันโฮสต์ข้ามร้านที่ชั้น DB ไม่พึ่ง RPC อย่างเดียว)
  constraint live_host_shop_id_uq unique (shop_id, id),
  -- บังคับ trim ในตารางเอง: unique index ด้านล่างเทียบ lower() — ช่องว่างหัวท้ายทำให้ "คนเดียวกัน" ซ้ำได้
  constraint live_host_display_name_check
    check (display_name = btrim(display_name) and length(display_name) between 1 and 80),
  constraint live_host_public_label_check
    check (public_label = btrim(public_label) and length(public_label) between 1 and 40)
);

create unique index if not exists live_host_shop_display_name_uq on analytics.live_host (shop_id, lower(display_name));
create unique index if not exists live_host_shop_public_label_uq on analytics.live_host (shop_id, lower(public_label));

comment on table analytics.live_host is
  'โฮสต์ไลฟ์ (entity) — display_name = ชื่อจริงที่เจ้าของรู้ (ภายในเท่านั้น ห้ามส่งออกนอกทีม/ห้ามใส่ใน brief สาธารณะ) · '
  'public_label = ป้ายที่ขึ้นจอได้ (เช่น "โฮสต์ A") · เขียนผ่าน analytics.live_host_upsert เท่านั้น';

drop trigger if exists trg_live_host_updated_at on analytics.live_host;
create trigger trg_live_host_updated_at
  before update on analytics.live_host
  for each row execute function public.set_updated_at();

alter table analytics.live_host enable row level security;
drop policy if exists tenant_isolation_select on analytics.live_host;
create policy tenant_isolation_select on analytics.live_host
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- ============================================================================
-- 2. live_session_log.host_id — nullable (3 คืนเดิมปล่อย null · เจ้าของเลือกย้อนหลังได้ ไม่ backfill)
--    composite FK + MATCH SIMPLE: host_id null = ไม่ตรวจ · host_id มีค่า = ต้องเป็นโฮสต์ของ shop_id
--    เดียวกับแถว log (design case "host_id ชี้โฮสต์ร้านอื่น")
--    ไม่มี UPDATE ใน migration นี้ ⇒ trigger set_updated_at ของตารางนี้ไม่ยิง (trap #19)
-- ============================================================================

alter table analytics.live_session_log add column if not exists host_id uuid;

do $c1fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_session_log_host_fk' and conrelid = 'analytics.live_session_log'::regclass
  ) then
    alter table analytics.live_session_log
      add constraint live_session_log_host_fk
      foreign key (shop_id, host_id) references analytics.live_host (shop_id, id);
  end if;
end
$c1fk$;

create index if not exists idx_live_session_log_host on analytics.live_session_log (host_id) where host_id is not null;

comment on column analytics.live_session_log.host_id is
  'โฮสต์คืนนั้น (nullable — คืนก่อน 0158 ไม่มีค่า) · composite FK กับ live_host(shop_id, id) · '
  'live_session_upsert ส่ง null = ไม่ทับค่าเดิม';

-- ============================================================================
-- 2b. content_url_ok — ด่านรูปแบบลิงก์ "ด่านเดียว" ที่ CHECK ของตาราง · content_url_norm · content_signal_capture
--     เรียกร่วมกัน (กันแก้ regex ที่หนึ่งแล้วลืมอีกที่) — อยู่ก่อนตารางเพราะ CHECK อ้างถึง
--     ผ่านเฉพาะ: scheme http/https · host = อักขระใดก็ได้ยกเว้น / ? # @ \ whitespace control ·
--     ส่วนหลัง host (path/query/fragment) ห้าม \ < > " whitespace control · ยาวไม่เกิน 500
--     🔴 ห้าม `@` ในส่วน host = ห้าม userinfo (https://good.com@evil.com/ ตัวอ่านคนเห็น good.com แต่ไปที่ evil.com) ·
--        `@` ใน path/query ได้ (TikTok /@shop/video/123)
--     ห้ามคืนค่าด้วยการ "ตัด" ส่วนที่ผิดทิ้ง — ผิด = ปฏิเสธทั้งลิงก์ · null = ไม่ผ่าน (ผู้เรียกใช้ is not true)
--     length เช็คก่อน regex ใน CASE (regex ไม่ต้องกวาดสตริงยาวหลายแสนตัว)
--     🔴 ห้ามอักขระ bidi/zero-width ทั้ง URL (U+200B-200F · 202A-202E · 2060-2064 · 2066-2069 · FEFF) —
--        RLO (U+202E) ทำให้ลิงก์ที่อ่านจากซ้ายไปขวาเห็นเป็นโดเมนอื่น · ZWSP ทำให้ลิงก์ "คนละอัน" หน้าตาเหมือนกัน
--        (security L-b) · escape แบบ backslash-u ใน ARE ของ Postgres ใช้ได้จริง (พิสูจน์ด้วย dry-run บน UTF8 — ดู verify-0158 B14)
--     ⚠️ ฟังก์ชันนี้ถูกใช้ใน CHECK content_signal_url_check — ดู comment on function ด้านล่าง
-- ============================================================================

create or replace function analytics.content_url_ok(p_url text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select case
    when p_url is null or length(p_url) > 500 then false
    when p_url ~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]' then false
    else p_url ~* '^https?://[^/?#@\\[:space:][:cntrl:]]+([/?#][^\\<>"[:space:][:cntrl:]]*)?$'
  end
$f$;

-- CHECK เก็บแค่ "ชื่อฟังก์ชัน" ไม่ใช่ตัว regex ⇒ create or replace ที่แก้ตัวฟังก์ชันไม่ตรวจแถวเดิมซ้ำ (แถวเก่าอาจไม่ผ่านกติกาใหม่
-- โดยไม่มีใครรู้) · drop function ... cascade จะลบ CHECK ทิ้งเงียบๆ
comment on function analytics.content_url_ok(text) is
  'ใช้ใน CHECK content_signal_url_check — แก้แล้วต้องตรวจแถวเดิมซ้ำ (drop/add constraint) · ห้าม drop ... cascade';

-- ============================================================================
-- 3. analytics.content_signal — กล่องสัญญาณ (รวมคลิปอ้างอิง = kind reference_clip)
--    ไม่เก็บ: screenshot · สคริปต์เต็ม · ชื่อคน/คอมเมนต์รายคน (brief v1 §2.1) — ไม่มีคอลัมน์ name/phone/email
--    ตัวเลขยอดเป็น bigint ล้วน ⇒ NaN/Infinity เข้าคอลัมน์ไม่ได้ตั้งแต่ชนิดข้อมูล (trap #4 ไม่เกิดกับ
--    bigint — cast พังก่อนถึง CHECK) · CHECK กันติดลบและเพดาน 10^10 ซ้ำอีกชั้น
-- ============================================================================

create table if not exists analytics.content_signal (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shop (id) on delete cascade,
  kind               text not null,
  source             text not null,
  seen_on            date not null,
  url                text,
  url_norm           text,
  summary            text not null,
  hook_text          text,
  hook_type          text,
  platform           text,
  account            text,
  account_followers  bigint,
  views              bigint,
  likes              bigint,
  comments           bigint,
  saves              bigint,
  shares             bigint,
  metrics_approx     boolean not null default false,
  metrics_seen_on    date,
  posted_on          date,
  format             text,
  duration_sec       int,
  customer_group     text,
  why_it_works       text,
  fit_3j             text,
  fit_rule_hit       text,
  status             text not null default 'new',
  status_reason      text,
  review_on          date,
  picked_step_id     uuid references analytics.campaign_step (id) on delete set null,
  origin_live_date   date,
  origin_post_id     uuid references analytics.content_post (id),
  origin_campaign_id uuid references analytics.campaign (id),
  radar_date         date,
  radar_angle_idx    int,
  confidence         text,
  created_by_role    text not null default 'owner',
  created_by         uuid references auth.users (id) on delete set null,
  updated_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint content_signal_kind_check
    check (kind in ('reference_clip', 'trend', 'live_question', 'craft_moment', 'insight')),
  -- host/craftsman = ที่มาของสัญญาณที่เจ้าของบันทึกแทน ไม่ใช่ actor (design §5.1 ✏️ ตัด assistant)
  constraint content_signal_source_check
    check (source in ('owner', 'host', 'craftsman', 'ai_radar', 'ai_web', 'system')),
  constraint content_signal_created_by_role_check
    check (created_by_role in ('owner', 'ai', 'system')),
  constraint content_signal_status_check
    check (status in ('new', 'picked', 'rejected', 'deferred')),
  constraint content_signal_deferred_review_check
    check (status <> 'deferred' or review_on is not null),
  constraint content_signal_url_pair_check
    check ((url is null) = (url_norm is null)),
  constraint content_signal_url_check
    check (url is null or analytics.content_url_ok(url)),
  constraint content_signal_url_norm_len_check
    check (url_norm is null or length(url_norm) <= 500),
  -- `~ '\S'` = มีอักขระที่ไม่ใช่ whitespace อย่างน้อยหนึ่งตัว (btrim ตัดแค่ space ไม่ตัด tab/newline ⇒ length(btrim()) อย่างเดียวปล่อยผ่าน)
  constraint content_signal_summary_check
    check (length(summary) between 1 and 300 and summary ~ '\S'),
  constraint content_signal_hook_text_check
    check (hook_text is null or (length(hook_text) between 1 and 500 and hook_text ~ '\S')),
  constraint content_signal_hook_type_check
    check (hook_type is null or hook_type in
      ('question', 'fact', 'warning', 'process', 'before_after', 'customer_voice', 'direct_live', 'story')),
  constraint content_signal_text_len_check
    check ((platform is null or length(platform) <= 40)
       and (account is null or length(account) <= 100)
       and (why_it_works is null or length(why_it_works) <= 1000)
       and (fit_rule_hit is null or length(fit_rule_hit) <= 200)
       and (status_reason is null or length(status_reason) <= 500)),
  -- ตัวเลข: ไม่ติดลบ + เพดาน 10^10 · null = "ไม่เห็น" ไม่ใช่ 0 (ห้าม coalesce ที่ชั้นไหน)
  constraint content_signal_counts_check
    check ((account_followers is null or (account_followers >= 0 and account_followers <= 10000000000))
       and (views    is null or (views    >= 0 and views    <= 10000000000))
       and (likes    is null or (likes    >= 0 and likes    <= 10000000000))
       and (comments is null or (comments >= 0 and comments <= 10000000000))
       and (saves    is null or (saves    >= 0 and saves    <= 10000000000))
       and (shares   is null or (shares   >= 0 and shares   <= 10000000000))),
  constraint content_signal_format_check
    check (format is null or format in
      ('talking_head', 'process', 'before_after', 'unboxing', 'qa', 'live_cut', 'comparison', 'story', 'other')),
  constraint content_signal_duration_check
    check (duration_sec is null or (duration_sec >= 1 and duration_sec <= 36000)),
  constraint content_signal_customer_group_check
    check (customer_group is null or customer_group in ('jewelry_925', 'silver_bar', 'other')),
  constraint content_signal_fit_check
    check (fit_3j is null or fit_3j in ('usable', 'adapt', 'unusable')),
  constraint content_signal_confidence_check
    check (confidence is null or confidence in ('fact', 'observation', 'hypothesis')),
  constraint content_signal_radar_idx_check
    check (radar_angle_idx is null or (radar_angle_idx >= 0 and radar_angle_idx <= 20)),
  constraint content_signal_posted_before_seen_check
    check (posted_on is null or posted_on <= seen_on),
  -- ธง "ตัวเลขจากค่าย่อ" ไร้ความหมายถ้าไม่มีตัวเลขสักช่อง (trap #14: RPC ส่งทุกช่องนี้ไปกับ insert เสมอ)
  constraint content_signal_approx_needs_number_check
    check (not metrics_approx
       or account_followers is not null or views is not null or likes is not null
       or comments is not null or saves is not null or shares is not null),
  -- ข้อกำหนดต่อ kind (design §5.1) — trap #14: RPC ส่งทุกคอลัมน์ที่ CHECK อ้างไปกับ insert เสมอ
  constraint content_signal_kind_requirements_check
    check ((kind <> 'reference_clip' or (url is not null and hook_text is not null))
       and (kind <> 'live_question'  or origin_live_date is not null)
       and (kind <> 'insight'        or (origin_post_id is not null or origin_campaign_id is not null))
       and (kind <> 'trend'          or radar_date is not null))
);

-- กันลิงก์ซ้ำในร้านเดียวกัน (DB กันได้โดยไม่พึ่งแอป) · แอป canonicalize TikTok ก่อนส่งเสมอ (R16)
create unique index if not exists content_signal_shop_url_norm_uq
  on analytics.content_signal (shop_id, url_norm) where url_norm is not null;
-- กัน log ส่งคำถามซ้ำตอน re-submit คืนเดิม
create unique index if not exists content_signal_live_question_uq
  on analytics.content_signal (shop_id, origin_live_date, summary) where kind = 'live_question';

create index if not exists idx_content_signal_shop_status on analytics.content_signal (shop_id, status, seen_on desc);
create index if not exists idx_content_signal_picked_step on analytics.content_signal (picked_step_id) where picked_step_id is not null;
create index if not exists idx_content_signal_origin_post on analytics.content_signal (origin_post_id) where origin_post_id is not null;
create index if not exists idx_content_signal_origin_campaign on analytics.content_signal (origin_campaign_id) where origin_campaign_id is not null;

comment on table analytics.content_signal is
  'กล่องสัญญาณ content 5 ชนิด (reference_clip/trend/live_question/craft_moment/insight) — เขียนผ่าน '
  'analytics.content_signal_capture / content_signal_set_status · 🔴 ห้ามใส่ชื่อ/เบอร์/PII ลูกค้าใน summary/why_it_works '
  '(คำถามไลฟ์ต้องตัดชื่อคนถามก่อนบันทึก) · mass_ratio/save_rate คำนวณใน v_content_signal ไม่เก็บ';
comment on column analytics.content_signal.url_norm is
  'ผลของ analytics.content_url_norm(url) — RPC คำนวณเอง ห้าม client ส่ง · ใช้กันลิงก์ซ้ำเท่านั้น';
comment on column analytics.content_signal.hook_text is
  'hook "ของเขา" ที่ถอดโครงจากคลิปอ้างอิง — เก็บเพื่อถอดโครง ห้ามใช้ซ้ำคำต่อคำ (brief v1 §2.1)';
comment on column analytics.content_signal.metrics_approx is
  'true = ตัวเลขที่กรอกมาจากค่าย่อ (เช่น 16K) · null ในช่องตัวเลข = ไม่เห็น ไม่ใช่ศูนย์';

drop trigger if exists trg_content_signal_updated_at on analytics.content_signal;
create trigger trg_content_signal_updated_at
  before update on analytics.content_signal
  for each row execute function public.set_updated_at();

alter table analytics.content_signal enable row level security;
drop policy if exists tenant_isolation_select on analytics.content_signal;
create policy tenant_isolation_select on analytics.content_signal
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- ============================================================================
-- 4. analytics.content_hook — hook เป็นแถว (ไม่ฝังใน clip_brief ต่อ — design §5.2)
--    hook_type = 8 ประเภทหรือ null · null ได้เฉพาะแถว legacy ที่ย้ายจาก JSON (มี legacy_json_id) ซึ่งเก็บ
--    ค่า free-form เดิมไว้ใน hook_type_raw ⇒ ไม่มีข้อมูลหาย ไม่เดาประเภท (ข้อยกเว้นแคบ: ผูกกับ
--    legacy_json_id · แถวใหม่จาก RPC บังคับ hook_type เสมอ)
-- ============================================================================

create table if not exists analytics.content_hook (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shop (id) on delete cascade,
  text             text not null,
  hook_type        text,
  origin           text not null,
  source_signal_id uuid references analytics.content_signal (id) on delete set null,
  step_id          uuid references analytics.campaign_step (id) on delete cascade,
  label            text,
  generated_by     text not null,
  hook_type_raw    text,
  legacy_json_id   text,
  created_by       uuid references auth.users (id) on delete set null,
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint content_hook_text_check check (length(text) between 1 and 500 and text ~ '\S'),
  constraint content_hook_type_check
    check (hook_type is null or hook_type in
      ('question', 'fact', 'warning', 'process', 'before_after', 'customer_voice', 'direct_live', 'story')),
  constraint content_hook_origin_check check (origin in ('reference', 'ours')),
  constraint content_hook_label_check check (label is null or label in ('A', 'B')),
  constraint content_hook_generated_by_check check (generated_by in ('ai', 'human')),
  -- ข้อยกเว้นแคบ: hook_type ว่างได้เฉพาะแถว legacy · hook_type_raw มีได้เฉพาะแถว legacy
  constraint content_hook_type_required_check
    check (hook_type is not null or legacy_json_id is not null),
  constraint content_hook_raw_legacy_only_check
    check (hook_type_raw is null or legacy_json_id is not null),
  constraint content_hook_legacy_len_check
    check ((hook_type_raw is null or length(hook_type_raw) <= 100)
       and (legacy_json_id is null or length(legacy_json_id) between 1 and 100)),
  -- ป้าย A/B มีได้เฉพาะ hook ของเราที่ผูก step · hook ของเขา (reference) ไม่ผูก step
  constraint content_hook_label_scope_check
    check (label is null or (origin = 'ours' and step_id is not null)),
  constraint content_hook_reference_scope_check
    check (origin = 'ours' or (step_id is null and label is null))
);

create unique index if not exists content_hook_step_label_uq
  on analytics.content_hook (step_id, label) where label is not null;
create unique index if not exists content_hook_step_legacy_uq
  on analytics.content_hook (step_id, legacy_json_id) where legacy_json_id is not null;
create index if not exists idx_content_hook_step on analytics.content_hook (step_id) where step_id is not null;
create index if not exists idx_content_hook_signal on analytics.content_hook (source_signal_id) where source_signal_id is not null;
create index if not exists idx_content_hook_shop_type on analytics.content_hook (shop_id, hook_type);

comment on table analytics.content_hook is
  'hook เป็นแถว: origin=ours ผูก step (ป้าย A/B) · origin=reference = hook ของเขาที่ถอดโครงจากสัญญาณ · '
  'step_artifact.clip_brief.hooks[] ยังอ่านได้แต่ RPC ใหม่ไม่เขียน (เลิกเป็นแหล่งจริงตั้งแต่ 0158) · '
  'rollup/ด่าน "≥2 ประเภทต่างกัน" ต้องไม่นับ hook_type null (R19)';
comment on column analytics.content_hook.hook_type_raw is
  'ค่า hook_type free-form เดิมจาก JSON (reveal/contrast/teaser ฯลฯ) — เก็บไว้ไม่ให้ข้อมูลหาย · ติดป้าย 8 ประเภททีหลัง';
comment on column analytics.content_hook.legacy_json_id is
  'hooks[].id เดิมใน clip_brief (เช่น h1) — chosen_hook_id ใน jsonb ยังชี้กลับได้';

drop trigger if exists trg_content_hook_updated_at on analytics.content_hook;
create trigger trg_content_hook_updated_at
  before update on analytics.content_hook
  for each row execute function public.set_updated_at();

alter table analytics.content_hook enable row level security;
drop policy if exists tenant_isolation_select on analytics.content_hook;
create policy tenant_isolation_select on analytics.content_hook
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- ============================================================================
-- 5. grant ตาราง — ถอด public/anon/authenticated ชัดๆ · service_role: grant select ตามแบบ 0148
--    (ความจริงจาก pg_default_acl: default privileges ให้ service_role ครบ DML + rolbypassrls ⇒ service_role
--    เขียนตรงได้เสมอ — RPC คือเส้นทางที่ตั้งใจ ไม่ใช่ด่านที่บล็อกได้ · ดู L7 ใน 0148)
-- ============================================================================

revoke all on analytics.live_host, analytics.content_signal, analytics.content_hook
  from public, anon, authenticated;
grant select on analytics.live_host, analytics.content_signal, analytics.content_hook to service_role;

-- ============================================================================
-- 6. helper: actor_role + url_norm
-- ============================================================================

-- ข้อความจากผู้ใช้ (summary · hook · คำถามไลฟ์): ลบอักขระ bidi/zero-width ก่อน แล้วค่อยยุบ whitespace + trim
-- (ลำดับสำคัญ: ZWSP ที่แทรกกลางช่องว่างต้องไม่กันการยุบ · ZWSP ล้วน = ว่างหลังลบ ⇒ ผู้เรียกจัดเป็น "ว่าง" เหมือน whitespace ล้วน)
-- null → '' (ผู้เรียกใช้ nullif/length เอง) · ชุดอักขระต้องตรงกับ content_url_ok
create or replace function analytics.content_text_clean(p_text text)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select btrim(regexp_replace(
           regexp_replace(coalesce(p_text, ''), '[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]', '', 'g'),
           '\s+', ' ', 'g'))
$f$;

-- 🔴 role มาจากแอป ไม่ใช่ auth (R14) — ค่านอก owner/ai/system raise 22023 · ค่าที่รู้จักแต่ไม่อยู่ใน
-- p_allowed raise 42501 (ข้อความไทย) — ใช้กันเส้นทาง AI ทำสิ่งที่ต้องเป็นเจ้าของ
create or replace function analytics.content_actor_assert(
  p_role text,
  p_allowed text[] default array['owner', 'ai', 'system'],
  p_fn text default 'content'
) returns void
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $f$
begin
  -- p_allowed null ⇒ `p_role = any(null)` เป็น null ⇒ `not null` = null ⇒ ด่านไม่ raise (ผ่านเงียบ) — ปฏิเสธตรงนี้
  -- ผู้เรียกที่ลืมส่งรายการ/ส่งตัวแปร null มาต้องล้ม ไม่ใช่เปิดให้ทุก role
  if p_allowed is null then
    raise exception '%: ไม่ได้ระบุรายการ actor_role ที่อนุญาต (p_allowed เป็น null)', p_fn using errcode = '22023';
  end if;
  if p_role is null or not (p_role = any (array['owner', 'ai', 'system'])) then
    raise exception '%: actor_role ต้องเป็น owner, ai หรือ system เท่านั้น (ได้รับ %)', p_fn, coalesce(p_role, 'null')
      using errcode = '22023';
  end if;
  -- coalesce: array ที่มี null ข้างใน (array['owner', null]) ทำให้ 'ai' = any(...) เป็น null ไม่ใช่ false ⇒ not null = null ⇒ ไม่ raise
  if not coalesce(p_role = any (p_allowed), false) then
    raise exception '%: actor_role % ไม่มีสิทธิ์ทำรายการนี้ (อนุญาตเฉพาะ %)', p_fn, p_role, array_to_string(p_allowed, '/')
      using errcode = '42501';
  end if;
end;
$f$;

-- ลิงก์ → รูป canonical สำหรับกันซ้ำ (D-d): host ตัวเล็ก · ตัดพอร์ตมาตรฐาน/www./m. · ตัด scheme/
-- fragment/trailing slash · เก็บ query เฉพาะตัวระบุคลิป (v · story_fbid · fbid · id) เรียงตามชื่อ ·
-- segment handle (ขึ้นต้น @) เป็นตัวเล็กเฉพาะ host tiktok.com — /t/<code> · video id · host อื่นห้ามแตะ (case-sensitive)
-- คืน null เมื่อไม่ผ่าน content_url_ok (รวม userinfo — ปฏิเสธ ไม่ตัดเงียบ) หรือ host ไม่ถูกรูป — ผู้เรียกต้อง raise เอง (ไม่เดา)
-- ⚠️ ลิงก์ย่อ (vt.tiktok.com) กับลิงก์เต็มของคลิปเดียวกัน DB รวมให้ไม่ได้ — แอป canonicalize ก่อนส่ง (R16)
create or replace function analytics.content_url_norm(p_url text)
 returns text
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
declare
  v_m     text[];
  v_host  text;
  v_path  text;
  v_kept  text;
begin
  if p_url is null or btrim(p_url) = '' then
    return null;
  end if;
  -- ด่านรูปแบบก่อน parse (userinfo/\/whitespace/control/<>"/ยาว >500 → null) — ไม่มีการตัดส่วนที่ผิดทิ้งแล้วไปต่อ
  if not analytics.content_url_ok(btrim(p_url)) then
    return null;
  end if;
  v_m := regexp_match(btrim(p_url), '^https?://([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$', 'i');
  if v_m is null then
    return null;
  end if;
  v_host := lower(v_m[1]);
  v_host := regexp_replace(v_host, ':(80|443)$', '');
  v_host := regexp_replace(v_host, '^(www|m)\.', '');
  if v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$' then
    return null;
  end if;
  v_path := regexp_replace(coalesce(v_m[2], ''), '/{2,}', '/', 'g');
  v_path := regexp_replace(v_path, '/+$', '');
  -- เฉพาะ segment ที่ขึ้นต้น @ (handle ไม่สนตัวพิมพ์) — /t/<code> ลิงก์สั้นและ video id เป็น case-sensitive ห้ามแตะ
  if v_host = 'tiktok.com' then
    v_path := coalesce((
      select string_agg(case when seg like '@%' then lower(seg) else seg end, '/' order by ord)
        from unnest(string_to_array(v_path, '/')) with ordinality as s(seg, ord)
    ), '');
  end if;
  select string_agg(lower(split_part(kv, '=', 1)) || '=' || substring(kv from position('=' in kv) + 1), '&'
                    order by lower(split_part(kv, '=', 1)))
    into v_kept
    from unnest(string_to_array(coalesce(v_m[3], ''), '&')) as kv
   where position('=' in kv) > 0
     and lower(split_part(kv, '=', 1)) in ('v', 'story_fbid', 'fbid', 'id');
  return v_host || v_path || case when v_kept is not null then '?' || v_kept else '' end;
end;
$f$;

-- ============================================================================
-- 7. live_host_upsert — owner/system เท่านั้น (AI สร้างคนในระบบไม่ได้ — D-b)
-- ============================================================================

create or replace function analytics.live_host_upsert(
  p_shop_id uuid,
  p_display_name text,
  p_public_label text,
  p_is_active boolean default true,
  p_id uuid default null,
  p_actor_role text default 'owner'
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  -- ชื่อ/ป้ายขึ้นจอ ⇒ ลบ bidi/zero-width + ยุบ whitespace (ZWSP ทำให้ "คนเดียวกัน" ซ้ำผ่านด่าน unique ได้ · RLO กลับทิศข้อความบนจอ)
  v_name   text := analytics.content_text_clean(p_display_name);
  v_label  text := analytics.content_text_clean(p_public_label);
  v_id     uuid;
  v_dup    uuid;
begin
  if p_shop_id is null then
    raise exception 'live_host_upsert: ต้องระบุร้าน' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'system'], 'live_host_upsert');
  if length(v_name) not between 1 and 80 then
    raise exception 'live_host_upsert: ชื่อโฮสต์ต้องยาว 1-80 ตัวอักษร' using errcode = '22023';
  end if;
  if length(v_label) not between 1 and 40 then
    raise exception 'live_host_upsert: ป้ายขึ้นจอต้องยาว 1-40 ตัวอักษร' using errcode = '22023';
  end if;
  if p_is_active is null then
    raise exception 'live_host_upsert: is_active ต้องเป็น true/false' using errcode = '22023';
  end if;

  if p_id is not null then
    -- for update + shop_id ใน where ตั้งแต่ต้น: ไม่แตะโฮสต์ของร้านอื่นแม้รู้ id
    perform 1 from analytics.live_host where id = p_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'live_host_upsert: ไม่พบโฮสต์ในร้านนี้' using errcode = '22023';
    end if;
  end if;

  select h.id into v_dup from analytics.live_host h
   where h.shop_id = p_shop_id and h.id is distinct from p_id
     and (lower(h.display_name) = lower(v_name) or lower(h.public_label) = lower(v_label))
   limit 1;
  if v_dup is not null then
    raise exception 'live_host_upsert: มีโฮสต์ชื่อหรือป้ายนี้อยู่แล้ว' using errcode = '23505', detail = v_dup::text;
  end if;

  if p_id is null then
    insert into analytics.live_host (shop_id, display_name, public_label, is_active, created_by, updated_by)
    values (p_shop_id, v_name, v_label, p_is_active, auth.uid(), auth.uid())
    returning id into v_id;
  else
    update analytics.live_host
       set display_name = v_name, public_label = v_label, is_active = p_is_active, updated_by = auth.uid()
     where id = p_id and shop_id = p_shop_id
     returning id into v_id;
  end if;
  return v_id;
end;
$f$;

-- ============================================================================
-- 8. content_signal_capture — บันทึกสัญญาณ (ทุก kind) · ซ้ำ = 23505 + id เดิมใน detail (R9: ไม่ใช้ on conflict)
-- ============================================================================

create or replace function analytics.content_signal_capture(
  p_shop_id uuid,
  p_kind text,
  p_summary text,
  p_source text default 'owner',
  p_seen_on date default null,
  p_url text default null,
  p_hook_text text default null,
  p_hook_type text default null,
  p_platform text default null,
  p_account text default null,
  p_account_followers bigint default null,
  p_views bigint default null,
  p_likes bigint default null,
  p_comments bigint default null,
  p_saves bigint default null,
  p_shares bigint default null,
  p_metrics_approx boolean default false,
  p_metrics_seen_on date default null,
  p_posted_on date default null,
  p_format text default null,
  p_duration_sec int default null,
  p_customer_group text default null,
  p_why_it_works text default null,
  p_fit_3j text default null,
  p_fit_rule_hit text default null,
  p_origin_live_date date default null,
  p_origin_post_id uuid default null,
  p_origin_campaign_id uuid default null,
  p_radar_date date default null,
  p_radar_angle_idx int default null,
  p_confidence text default null,
  p_actor_role text default 'owner'
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today    date := (now() at time zone 'Asia/Bangkok')::date;
  -- ลบ bidi/zero-width + ยุบ whitespace (รวม tab/newline) แล้วค่อย trim (content_text_clean) — ลำดับกลับกันทำให้ tab ล้วนกลายเป็น ' ' ที่ btrim ไม่เห็นว่าว่าง
  v_summary  text := analytics.content_text_clean(p_summary);
  v_hook     text := nullif(analytics.content_text_clean(p_hook_text), '');
  v_url      text := nullif(btrim(coalesce(p_url, '')), '');
  v_norm     text;
  v_seen     date;
  v_id       uuid;
  v_dup      uuid;
begin
  if p_shop_id is null then
    raise exception 'content_signal_capture: ต้องระบุร้าน' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'content_signal_capture');

  if p_kind is null or p_kind not in ('reference_clip', 'trend', 'live_question', 'craft_moment', 'insight') then
    raise exception 'content_signal_capture: kind ไม่ถูกต้อง' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('owner', 'host', 'craftsman', 'ai_radar', 'ai_web', 'system') then
    raise exception 'content_signal_capture: source ไม่ถูกต้อง' using errcode = '22023';
  end if;
  -- AI ห้ามอ้างว่าเจ้าของ/โฮสต์/ช่างเป็นคนเห็น — ที่มาของ AI ต้องเป็น ai_radar/ai_web
  if p_actor_role = 'ai' and p_source not in ('ai_radar', 'ai_web') then
    raise exception 'content_signal_capture: AI บันทึกได้เฉพาะ source ai_radar หรือ ai_web' using errcode = '22023';
  end if;
  if length(v_summary) not between 1 and 300 then
    raise exception 'content_signal_capture: summary ต้องมี 1 บรรทัด ยาว 1-300 ตัวอักษร' using errcode = '22023';
  end if;
  if v_hook is not null and length(v_hook) > 500 then
    raise exception 'content_signal_capture: hook_text ยาวเกิน 500 ตัวอักษร' using errcode = '22023';
  end if;

  -- ตัวเลข: กันติดลบ/เกินเพดาน (bigint ไม่มี NaN ⇒ trap #4 ไม่เกิด · คงรูป not(between) เผื่อเปลี่ยนชนิด) · null = ไม่เห็น ผ่านได้
  if exists (
    select 1 from unnest(array[p_account_followers, p_views, p_likes, p_comments, p_saves, p_shares]) as n(x)
    where x is not null and not (x >= 0 and x <= 10000000000)
  ) then
    raise exception 'content_signal_capture: ตัวเลขยอด/ผู้ติดตามต้องอยู่ระหว่าง 0 ถึง 10,000,000,000 (ไม่เห็นให้เว้นว่าง ห้ามใส่ 0)'
      using errcode = '22023';
  end if;
  if coalesce(p_metrics_approx, false)
     and p_account_followers is null and p_views is null and p_likes is null
     and p_comments is null and p_saves is null and p_shares is null then
    raise exception 'content_signal_capture: ติดธง "ตัวเลขประมาณ" แต่ไม่มีตัวเลขสักช่อง' using errcode = '22023';
  end if;
  if p_duration_sec is not null and not (p_duration_sec >= 1 and p_duration_sec <= 36000) then
    raise exception 'content_signal_capture: duration_sec ต้องอยู่ระหว่าง 1 ถึง 36000' using errcode = '22023';
  end if;

  v_seen := coalesce(p_seen_on, v_today);
  if v_seen > v_today then
    raise exception 'content_signal_capture: seen_on อยู่ในอนาคต' using errcode = '22023';
  end if;
  if p_posted_on is not null and p_posted_on > v_seen then
    raise exception 'content_signal_capture: posted_on ต้องไม่หลังวันที่เห็น' using errcode = '22023';
  end if;
  if p_metrics_seen_on is not null and p_metrics_seen_on > v_today then
    raise exception 'content_signal_capture: metrics_seen_on อยู่ในอนาคต' using errcode = '22023';
  end if;

  -- ความยาว/รูปแบบก่อน norm (ไม่ให้ norm ประมวลผลสตริงยาวหลายแสนตัว) · ผิด = ปฏิเสธทั้งลิงก์ ไม่ตัดแก้ให้
  if v_url is not null then
    -- content_url_ok เช็คความยาวเองก่อน regex อยู่แล้ว ⇒ ไม่เช็คซ้ำ · แยกแค่ข้อความให้บอกว่า "ยาวเกิน"
    if not analytics.content_url_ok(v_url) then
      raise exception 'content_signal_capture: %',
        case when length(v_url) > 500 then 'ลิงก์ยาวเกิน 500 ตัวอักษร'
             else 'ลิงก์ไม่ถูกต้อง (ต้องเป็น http/https ไม่มี user@ ช่องว่าง \ < > ")' end
        using errcode = '22023';
    end if;
    v_norm := analytics.content_url_norm(v_url);
    if v_norm is null then
      raise exception 'content_signal_capture: ลิงก์ไม่ถูกต้อง (โดเมนไม่ถูกรูป)' using errcode = '22023';
    end if;
  end if;

  -- ข้อกำหนดต่อ kind — เช็คเองเพื่อข้อความไทย (CHECK ในตารางเป็นด่านจริงซ้ำอีกชั้น)
  if p_kind = 'reference_clip' and (v_url is null or v_hook is null) then
    raise exception 'content_signal_capture: คลิปอ้างอิงต้องมีลิงก์และ hook_text' using errcode = '22023';
  end if;
  if p_kind = 'live_question' and p_origin_live_date is null then
    raise exception 'content_signal_capture: คำถามไลฟ์ต้องระบุคืนที่ไลฟ์ (origin_live_date)' using errcode = '22023';
  end if;
  if p_kind = 'insight' and p_origin_post_id is null and p_origin_campaign_id is null then
    raise exception 'content_signal_capture: บทเรียนต้องผูกโพสต์หรือแคมเปญ' using errcode = '22023';
  end if;
  if p_kind = 'trend' and p_radar_date is null then
    raise exception 'content_signal_capture: เทรนด์ต้องระบุวัน radar (radar_date)' using errcode = '22023';
  end if;

  -- FK กันแค่ "มีอยู่" ไม่กัน "ข้ามร้าน" ⇒ เช็ค shop เองทุกตัว
  if p_origin_post_id is not null
     and not exists (select 1 from analytics.content_post where id = p_origin_post_id and shop_id = p_shop_id) then
    raise exception 'content_signal_capture: ไม่พบโพสต์ในร้านนี้' using errcode = '22023';
  end if;
  if p_origin_campaign_id is not null
     and not exists (select 1 from analytics.campaign where id = p_origin_campaign_id and shop_id = p_shop_id) then
    raise exception 'content_signal_capture: ไม่พบแคมเปญในร้านนี้' using errcode = '22023';
  end if;

  if v_norm is not null then
    select id into v_dup from analytics.content_signal where shop_id = p_shop_id and url_norm = v_norm;
    if v_dup is not null then
      raise exception 'content_signal_capture: ลิงก์นี้ถูกบันทึกไว้แล้ว' using errcode = '23505', detail = v_dup::text;
    end if;
  end if;
  if p_kind = 'live_question' then
    select id into v_dup from analytics.content_signal
     where shop_id = p_shop_id and kind = 'live_question' and origin_live_date = p_origin_live_date and summary = v_summary;
    if v_dup is not null then
      raise exception 'content_signal_capture: คำถามนี้ถูกบันทึกไว้แล้วสำหรับคืนนั้น' using errcode = '23505', detail = v_dup::text;
    end if;
  end if;

  begin
    insert into analytics.content_signal (
      shop_id, kind, source, seen_on, url, url_norm, summary, hook_text, hook_type, platform, account,
      account_followers, views, likes, comments, saves, shares, metrics_approx, metrics_seen_on, posted_on,
      format, duration_sec, customer_group, why_it_works, fit_3j, fit_rule_hit,
      origin_live_date, origin_post_id, origin_campaign_id, radar_date, radar_angle_idx, confidence,
      created_by_role, created_by, updated_by
    ) values (
      p_shop_id, p_kind, p_source, v_seen, v_url, v_norm, v_summary, v_hook, p_hook_type,
      lower(nullif(analytics.content_text_clean(p_platform), '')), nullif(analytics.content_text_clean(p_account), ''),
      p_account_followers, p_views, p_likes, p_comments, p_saves, p_shares, coalesce(p_metrics_approx, false),
      p_metrics_seen_on, p_posted_on,
      p_format, p_duration_sec, p_customer_group, nullif(analytics.content_text_clean(p_why_it_works), ''), p_fit_3j,
      nullif(analytics.content_text_clean(p_fit_rule_hit), ''),
      p_origin_live_date, p_origin_post_id, p_origin_campaign_id, p_radar_date, p_radar_angle_idx, p_confidence,
      p_actor_role, auth.uid(), auth.uid()
    ) returning id into v_id;
  exception when unique_violation then
    -- แข่งกันบันทึกพร้อมกัน: pre-check ข้างบนผ่านทั้งคู่ แต่ unique index จับได้ที่ insert
    select id into v_dup from analytics.content_signal
     where shop_id = p_shop_id
       and ((v_norm is not null and url_norm = v_norm)
         or (p_kind = 'live_question' and kind = 'live_question' and origin_live_date = p_origin_live_date and summary = v_summary))
     limit 1;
    raise exception 'content_signal_capture: บันทึกซ้ำกับสัญญาณที่มีอยู่แล้ว' using errcode = '23505', detail = coalesce(v_dup::text, '');
  end;
  return v_id;
end;
$f$;

-- ============================================================================
-- 9. content_signal_set_status — owner/system เท่านั้น (AI ตัดสิน "ไม่ใช้/เก็บไว้" แทนเจ้าของไม่ได้ — D-b)
--    picked ตั้งไม่ได้ที่นี่: ต้องผูกกับ step (content_signal_pick อยู่ C2 — D-a)
-- ============================================================================

create or replace function analytics.content_signal_set_status(
  p_shop_id uuid,
  p_id uuid,
  p_status text,
  p_reason text default null,
  p_review_on date default null,
  p_actor_role text default 'owner',
  p_force boolean default false
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_reason  text := nullif(analytics.content_text_clean(p_reason), '');
  v_row     analytics.content_signal%rowtype;
begin
  if p_shop_id is null or p_id is null then
    raise exception 'content_signal_set_status: ต้องระบุร้านและสัญญาณ' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'system'], 'content_signal_set_status');

  if p_status is null or p_status not in ('new', 'rejected', 'deferred') then
    raise exception 'content_signal_set_status: ตั้งได้เฉพาะ new/rejected/deferred (สถานะ picked ตั้งผ่านการหยิบเป็นชิ้นงานเท่านั้น)'
      using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'content_signal_set_status: เหตุผลยาวเกิน 500 ตัวอักษร' using errcode = '22023';
  end if;
  if p_status = 'deferred' then
    if p_review_on is null or p_review_on < v_today then
      raise exception 'content_signal_set_status: เก็บไว้ก่อนต้องระบุวันกลับมาดู (วันนี้หรืออนาคต)' using errcode = '22023';
    end if;
  elsif p_review_on is not null then
    raise exception 'content_signal_set_status: review_on ใช้กับสถานะเก็บไว้ก่อนเท่านั้น' using errcode = '22023';
  end if;

  select * into v_row from analytics.content_signal where id = p_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_signal_set_status: ไม่พบสัญญาณในร้านนี้' using errcode = '22023';
  end if;

  if v_row.status = 'picked' then
    if p_status = 'new' then
      raise exception 'content_signal_set_status: สัญญาณที่หยิบแล้วย้อนกลับเป็นใหม่ไม่ได้' using errcode = '22023';
    end if;
    if not coalesce(p_force, false) then
      raise exception 'content_signal_set_status: สัญญาณนี้ถูกหยิบเป็นชิ้นงานแล้ว — ยืนยันซ้ำด้วย p_force'
        using errcode = '22023', detail = coalesce(v_row.picked_step_id::text, '');
    end if;
  end if;

  update analytics.content_signal
     set status = p_status,
         status_reason = case when p_status = 'new' then null else v_reason end,
         review_on = case when p_status = 'deferred' then p_review_on else null end,
         updated_by = auth.uid()
   where id = p_id and shop_id = p_shop_id;

  return jsonb_build_object(
    'id', p_id, 'status', p_status,
    'review_on', case when p_status = 'deferred' then to_jsonb(p_review_on) else 'null'::jsonb end,
    'picked_step_id', to_jsonb(v_row.picked_step_id));
end;
$f$;

-- ============================================================================
-- 10. content_hook_upsert — AI/เจ้าของเขียน hook ของ step (signature ของ campaign_ai_draft_artifact ไม่แตะ)
--     กติกา A/B: คนละประเภท (ไม่นับ hook_type null ของ legacy) · ป้ายซ้ำใน step เดียวไม่ได้
--     เพิ่ม p_shop_id นำหน้า (design §5.2 ไม่มี) ให้สอดคล้อง RPC อื่นและเช็คข้ามร้านได้
--     🔴 แทนที่ hook เดิม = ต้องส่ง p_id เท่านั้น — ส่งป้ายที่ step นี้มีอยู่แล้วโดยไม่ส่ง p_id = 23505 ไม่ทับเงียบ
--        (เดิม: ป้ายซ้ำ = แก้แถวเดิมเงียบๆ ⇒ AI ทับ hook ที่เจ้าของเลือกไว้โดยไม่รู้ตัว — security S-M3 / QA K9)
--     🔴 AI แก้/ทับ hook ที่ generated_by='human' ไม่ได้ (42501) แม้ส่ง p_id ถูก — เจ้าของ/ระบบแก้ hook ของ AI ได้
--        (แล้วแถวนั้นกลายเป็น human)
-- ============================================================================

create or replace function analytics.content_hook_upsert(
  p_shop_id uuid,
  p_step_id uuid,
  p_label text,
  p_text text,
  p_hook_type text,
  p_source_signal_id uuid default null,
  p_actor_role text default 'owner',
  p_id uuid default null
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_text        text := nullif(analytics.content_text_clean(p_text), '');
  v_id          uuid;
  v_gen         text;
  v_exist       uuid;
  v_other_type  text;
begin
  if p_shop_id is null or p_step_id is null then
    raise exception 'content_hook_upsert: ต้องระบุร้านและชิ้นงาน (step)' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'content_hook_upsert');

  if v_text is null or length(v_text) > 500 then
    raise exception 'content_hook_upsert: ข้อความ hook ต้องยาว 1-500 ตัวอักษร' using errcode = '22023';
  end if;
  if p_hook_type is null
     or p_hook_type not in ('question', 'fact', 'warning', 'process', 'before_after', 'customer_voice', 'direct_live', 'story') then
    raise exception 'content_hook_upsert: hook_type ต้องเป็น 1 ใน 8 ประเภท (question/fact/warning/process/before_after/customer_voice/direct_live/story)'
      using errcode = '22023';
  end if;
  if p_label is not null and p_label not in ('A', 'B') then
    raise exception 'content_hook_upsert: label ต้องเป็น A หรือ B' using errcode = '22023';
  end if;

  -- ล็อก step ก่อน: serialize การตั้ง A/B ของ step เดียวกัน (กัน 2 คำขอพร้อมกันได้ A ซ้ำ/ประเภทซ้ำ)
  perform 1 from analytics.campaign_step where id = p_step_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_hook_upsert: ไม่พบชิ้นงานในร้านนี้' using errcode = '22023';
  end if;
  if p_source_signal_id is not null
     and not exists (select 1 from analytics.content_signal where id = p_source_signal_id and shop_id = p_shop_id) then
    raise exception 'content_hook_upsert: ไม่พบสัญญาณต้นทางในร้านนี้' using errcode = '22023';
  end if;

  if p_id is not null then
    select h.id, h.generated_by into v_id, v_gen from analytics.content_hook h
     where h.id = p_id and h.shop_id = p_shop_id and h.step_id = p_step_id and h.origin = 'ours' for update;
    if not found then
      raise exception 'content_hook_upsert: ไม่พบ hook ของชิ้นงานนี้' using errcode = '22023';
    end if;
    if p_actor_role = 'ai' and v_gen = 'human' then
      raise exception 'content_hook_upsert: AI แก้/ทับ hook ที่คนเขียนหรือแก้ไว้ไม่ได้ (ต้องเจ้าของเป็นคนแก้)' using errcode = '42501';
    end if;
  end if;

  if p_label is not null then
    -- ป้ายซ้ำชั้นเดียว: แถวอื่นของ step นี้ถือป้ายนี้อยู่ (ไม่ส่ง p_id ⇒ v_id null ⇒ ทุกแถวนับเป็น "อื่น" = สร้างใหม่เท่านั้น
    -- ผู้เรียกต้องเลือกแทนที่ด้วย p_id อย่างชัดแจ้ง) · detail = id ของแถวที่ชน
    select h.id into v_exist from analytics.content_hook h
     where h.step_id = p_step_id and h.label = p_label and h.id is distinct from v_id;
    if v_exist is not null then
      raise exception 'content_hook_upsert: ชิ้นงานนี้มี hook ป้าย % อยู่แล้ว — จะแทนที่ต้องส่ง p_id', p_label
        using errcode = '23505', detail = v_exist::text;
    end if;
    select h.hook_type into v_other_type from analytics.content_hook h
     where h.step_id = p_step_id and h.label is not null and h.label <> p_label and h.hook_type is not null
     limit 1;
    if v_other_type is not null and v_other_type = p_hook_type then
      raise exception 'content_hook_upsert: hook A กับ B ต้องคนละประเภท (ซ้ำกับป้ายอื่น: %)', v_other_type using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    insert into analytics.content_hook
      (shop_id, text, hook_type, origin, source_signal_id, step_id, label, generated_by, created_by, updated_by)
    values
      (p_shop_id, v_text, p_hook_type, 'ours', p_source_signal_id, p_step_id, p_label,
       case when p_actor_role = 'ai' then 'ai' else 'human' end, auth.uid(), auth.uid())
    returning id into v_id;
  else
    update analytics.content_hook
       set text = v_text, hook_type = p_hook_type, label = p_label,
           source_signal_id = coalesce(p_source_signal_id, source_signal_id),
           generated_by = case when p_actor_role = 'ai' then 'ai' else 'human' end,
           updated_by = auth.uid()
     where id = v_id;
  end if;
  return v_id;
end;
$f$;

-- ============================================================================
-- 11. live_session_upsert v2
--     trap #1: เพิ่มพารามิเตอร์ (แม้มี default) = overload ใหม่ ⇒ drop signature เดิมเต็มๆ ก่อน
--     พารามิเตอร์เดิม 7 ตัว ชื่อและลำดับเดิมเป๊ะ (แอปเรียก named-arg p_shop/p_live_date/p_start/p_end/
--     p_peak/p_note/p_source) · ตัวใหม่ 3 ตัวต่อท้ายเป็น default ⇒ ทางเรียกเดิมไม่พัง ·
--     ข้อความ error เดิมคงทุกตัวอักษร (live-metrics-errors.ts จับด้วยข้อความ P0001) ·
--     ข้อความใหม่ใช้ errcode 22023 (มาตรฐานใหม่ของ 0148/0153) — mapper ฝั่งแอปจะ fallback จนกว่า UI รอบ 2
-- ============================================================================

drop function if exists analytics.live_session_upsert(uuid, date, time, time, int, text, text);

create or replace function analytics.live_session_upsert(
  p_shop uuid,
  p_live_date date,
  p_start time,
  p_end time,
  p_peak int default null,
  p_note text default null,
  p_source text default 'owner_chat',
  p_host_id uuid default null,
  p_questions text[] default null,
  p_actor_role text default 'owner'
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_start     timestamptz;
  v_end       timestamptz;
  v_id        uuid;
  v_host_ok   boolean;
  v_cur_host  uuid;
  v_q_src     text;
  v_q_raw     text;
  v_q         text;
begin
  if p_shop is null or p_live_date is null or p_start is null or p_end is null then
    raise exception 'live_session_upsert: ต้องระบุ shop, วันที่ไลฟ์, เวลาเริ่ม และเวลาเลิก';
  end if;
  perform analytics.crm_require_owner_admin(p_shop);  -- ด่านสิทธิ์ก่อน validate อื่น (กัน probe)
  -- บันทึกหลังไลฟ์ = ข้อมูลของเจ้าของ — AI เขียนไม่ได้เลย (42501) · ด่านนี้อยู่ก่อน validate/เขียนอะไรทั้งสิ้น
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'system'], 'live_session_upsert');
  if p_peak is not null and p_peak < 0 then
    raise exception 'live_session_upsert: viewer สูงสุดต้องไม่ติดลบ';
  end if;
  if p_note is not null and length(btrim(p_note)) > 500 then
    raise exception 'live_session_upsert: p_note ยาวเกิน 500 ตัวอักษร';
  end if;
  if p_source not in ('owner_chat', 'admin_ui', 'backfill') then
    raise exception 'live_session_upsert: invalid source %', p_source;
  end if;
  if p_start = p_end then
    raise exception 'live_session_upsert: เวลาเริ่มกับเวลาเลิกไลฟ์ห้ามเท่ากัน';
  end if;

  -- เขตเวลาไทย (trap #6): ต่อ date+time เป็น naive แล้วแปลงด้วย at time zone · ข้ามเที่ยงคืน = +1 วัน
  v_start := (p_live_date + p_start) at time zone 'Asia/Bangkok';
  v_end := (p_live_date + (case when p_end <= p_start then 1 else 0 end) + p_end) at time zone 'Asia/Bangkok';
  if v_end - v_start > interval '12 hours' then
    raise exception 'live_session_upsert: เวลาเริ่ม-เลิกน่าจะสลับกัน (ได้ไลฟ์ยาวเกิน 12 ชั่วโมง)';
  end if;

  -- โฮสต์: ต้องเป็นของร้านนี้ (composite FK กันซ้ำที่ DB · เช็คเองเพื่อข้อความไทย) · โฮสต์ที่ปิดใช้งานแล้ว
  -- มอบหมายใหม่ไม่ได้ แต่แถวเดิมที่ใช้โฮสต์นั้นอยู่แล้วส่งซ้ำได้
  if p_host_id is not null then
    select (h.is_active) into v_host_ok from analytics.live_host h where h.id = p_host_id and h.shop_id = p_shop;
    if not found then
      raise exception 'live_session_upsert: ไม่พบโฮสต์ในร้านนี้' using errcode = '22023';
    end if;
    if not v_host_ok then
      select l.host_id into v_cur_host from analytics.live_session_log l where l.shop_id = p_shop and l.live_date = p_live_date;
      if v_cur_host is distinct from p_host_id then
        raise exception 'live_session_upsert: โฮสต์นี้ปิดใช้งานแล้ว' using errcode = '22023';
      end if;
    end if;
  end if;

  if p_questions is not null and cardinality(p_questions) > 20 then
    raise exception 'live_session_upsert: คำถามไลฟ์ส่งได้ไม่เกิน 20 ข้อต่อครั้ง' using errcode = '22023';
  end if;
  -- ตรวจความยาวคำถามก่อนเขียนอะไรทั้งสิ้น (ไม่ truncate เงียบๆ)
  if p_questions is not null then
    foreach v_q_raw in array p_questions loop
      v_q := analytics.content_text_clean(v_q_raw);
      if length(v_q) > 300 then
        raise exception 'live_session_upsert: คำถามไลฟ์ 1 ข้อต้องไม่เกิน 300 ตัวอักษร' using errcode = '22023';
      end if;
    end loop;
  end if;

  insert into analytics.live_session_log
    (shop_id, live_date, started_at, ended_at, peak_viewers, note, source, host_id, created_by, updated_by, updated_at)
  values
    (p_shop, p_live_date, v_start, v_end, p_peak, nullif(btrim(coalesce(p_note, '')), ''), p_source, p_host_id,
     auth.uid(), auth.uid(), now())
  on conflict (shop_id, live_date) do update set
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    peak_viewers = excluded.peak_viewers,
    note = excluded.note,
    source = excluded.source,
    -- D-c: ส่ง null = ไม่ทับโฮสต์ที่เลือกไว้ (แอปเดิมไม่รู้จัก host_id)
    host_id = coalesce(excluded.host_id, analytics.live_session_log.host_id),
    updated_by = auth.uid(),
    updated_at = now()
  returning id into v_id;

  -- คำถามซ้ำ → content_signal kind live_question (fact ชั้นเดียว · ไม่เก็บซ้ำใน note) · unique กันซ้ำตอน re-submit
  if p_questions is not null then
    -- source ตาม actor (ผ่านด่านข้างบนมาแล้ว = owner|system เท่านั้น ซึ่งเป็นค่าที่ source CHECK รับทั้งคู่) —
    -- ไม่ hardcode 'owner' ให้ทุกคน: คำถามที่ระบบส่งต้องไม่ถูกจดว่าเจ้าของเห็นเอง
    v_q_src := p_actor_role;
    foreach v_q_raw in array p_questions loop
      -- ว่างหลังยุบ whitespace = ข้ามข้อนั้น ไม่ให้ทั้งคืน rollback (CHECK summary ปฏิเสธ summary ว่าง)
      v_q := nullif(analytics.content_text_clean(v_q_raw), '');
      if v_q is null then
        continue;
      end if;
      insert into analytics.content_signal
        (shop_id, kind, source, seen_on, summary, origin_live_date, created_by_role, created_by, updated_by)
      values
        (p_shop, 'live_question', v_q_src, p_live_date, v_q, p_live_date, p_actor_role, auth.uid(), auth.uid())
      on conflict (shop_id, origin_live_date, summary) where kind = 'live_question' do nothing;
    end loop;
  end if;

  return v_id;
end;
$f$;

-- ============================================================================
-- 12. view ใหม่ (ไม่แตะ view เดิมเลย — trap #3) · security_invoker · service_role อ่านอย่างเดียว
-- ============================================================================

-- เส้น mass 2.0 / 0.5 เป็น [Hypothesis] (brief v1 §2.2 — ทบทวนเมื่อมี ≥30 reference ที่มี follower)
-- ⇒ อยู่ใน view ที่เดียว ไม่ใช่ CHECK/คอลัมน์เก็บ · แก้ครั้งเดียวไม่ต้อง backfill
-- คอลัมน์ที่คำนวณมีความหมายเฉพาะ reference_clip — kind อื่นได้ null
create or replace view analytics.v_content_signal
  with (security_invoker = true) as
select
  s.id, s.shop_id, s.kind, s.source, s.seen_on, s.url, s.summary, s.hook_text, s.hook_type,
  s.platform, s.account, s.account_followers, s.views, s.likes, s.comments, s.saves, s.shares,
  s.metrics_approx, s.metrics_seen_on, s.posted_on, s.format, s.duration_sec, s.customer_group,
  s.why_it_works, s.fit_3j, s.fit_rule_hit, s.status, s.status_reason, s.review_on, s.picked_step_id,
  s.origin_live_date, s.origin_post_id, s.origin_campaign_id, s.radar_date, s.radar_angle_idx,
  s.confidence, s.created_by_role, s.created_at, s.updated_at,
  case when s.kind = 'reference_clip'
       then round(s.views::numeric / nullif(s.account_followers, 0), 4) end as mass_ratio,
  case when s.kind <> 'reference_clip' then null
       when s.views is null or s.account_followers is null or s.account_followers = 0 then 'unknown'
       when s.views::numeric / s.account_followers >= 2.0 then 'mass'
       when s.views::numeric / s.account_followers >= 0.5 then 'normal'
       else 'low' end as mass_label,
  case when s.kind = 'reference_clip' and s.posted_on is not null
       then (s.seen_on - s.posted_on) < 3 end as is_unripe,
  case when s.kind = 'reference_clip'
       then round(s.saves::numeric / nullif(s.views, 0), 6) end as save_rate
from analytics.content_signal s;

-- คืนที่ค้าง 7 วัน (วันไทย วันนี้ย้อน 6 วัน) × ร้าน left join log — 1 แถว/ร้าน/วัน
-- เปิดเฉพาะ host_public_label โดยตั้งใจ — ชื่อจริง (live_host.display_name) ไม่อยู่ใน view ที่ขึ้นจอ
create or replace view analytics.v_live_log_recent
  with (security_invoker = true) as
select
  sh.id as shop_id,
  g.ts::date as live_date,
  (l.id is not null) as logged,
  l.id as log_id,
  l.host_id,
  h.public_label as host_public_label,
  l.peak_viewers,
  to_char(l.started_at at time zone 'Asia/Bangkok', 'HH24:MI') as started_time_th,
  to_char(l.ended_at at time zone 'Asia/Bangkok', 'HH24:MI') as ended_time_th
from public.shop sh
cross join generate_series(
  ((now() at time zone 'Asia/Bangkok')::date - 6)::timestamp,
  (now() at time zone 'Asia/Bangkok')::date::timestamp,
  interval '1 day') as g(ts)
left join analytics.live_session_log l on l.shop_id = sh.id and l.live_date = g.ts::date
left join analytics.live_host h on h.id = l.host_id and h.shop_id = l.shop_id;

revoke all on analytics.v_content_signal, analytics.v_live_log_recent from public, anon, authenticated;
grant select on analytics.v_content_signal, analytics.v_live_log_recent to service_role;

-- ============================================================================
-- 13. grant ฟังก์ชัน — ทุกตัว revoke ครบสามชื่อ แล้ว grant service_role อย่างเดียว (trap #2/#18)
--     ⚠️ ห้ามมี `to authenticated` ในไฟล์นี้ (สคีมา analytics)
-- ============================================================================

revoke execute on function analytics.content_actor_assert(text, text[], text) from public, anon, authenticated;
grant  execute on function analytics.content_actor_assert(text, text[], text) to service_role;

revoke execute on function analytics.content_text_clean(text) from public, anon, authenticated;
grant  execute on function analytics.content_text_clean(text) to service_role;

revoke execute on function analytics.content_url_norm(text) from public, anon, authenticated;
grant  execute on function analytics.content_url_norm(text) to service_role;

revoke execute on function analytics.content_url_ok(text) from public, anon, authenticated;
grant  execute on function analytics.content_url_ok(text) to service_role;

revoke execute on function analytics.live_host_upsert(uuid, text, text, boolean, uuid, text) from public, anon, authenticated;
grant  execute on function analytics.live_host_upsert(uuid, text, text, boolean, uuid, text) to service_role;

revoke execute on function analytics.content_signal_capture(
  uuid, text, text, text, date, text, text, text, text, text, bigint, bigint, bigint, bigint, bigint, bigint,
  boolean, date, date, text, int, text, text, text, text, date, uuid, uuid, date, int, text, text)
  from public, anon, authenticated;
grant  execute on function analytics.content_signal_capture(
  uuid, text, text, text, date, text, text, text, text, text, bigint, bigint, bigint, bigint, bigint, bigint,
  boolean, date, date, text, int, text, text, text, text, date, uuid, uuid, date, int, text, text)
  to service_role;

revoke execute on function analytics.content_signal_set_status(uuid, uuid, text, text, date, text, boolean)
  from public, anon, authenticated;
grant  execute on function analytics.content_signal_set_status(uuid, uuid, text, text, date, text, boolean) to service_role;

revoke execute on function analytics.content_hook_upsert(uuid, uuid, text, text, text, uuid, text, uuid)
  from public, anon, authenticated;
grant  execute on function analytics.content_hook_upsert(uuid, uuid, text, text, text, uuid, text, uuid) to service_role;

revoke execute on function analytics.live_session_upsert(uuid, date, time, time, int, text, text, uuid, text[], text)
  from public, anon, authenticated;
grant  execute on function analytics.live_session_upsert(uuid, date, time, time, int, text, text, uuid, text[], text)
  to service_role;

comment on function analytics.live_session_upsert(uuid, date, time, time, int, text, text, uuid, text[], text) is
  'v2 (0158): เพิ่ม p_host_id/p_questions/p_actor_role ท้ายสุด (default) — ทางเรียกเดิม 7 พารามิเตอร์ใช้ได้ · '
  'p_host_id null = ไม่ทับโฮสต์เดิม · p_questions → content_signal live_question (ห้ามใส่ชื่อ/เบอร์ลูกค้า) · '
  'actor_role owner|system เท่านั้น (AI = 42501) · มาจากแอป ไม่ใช่ auth (R14)';

-- ============================================================================
-- 14. backfill hook 26 แถวจาก step_artifact.clip_brief.hooks[] (design §5.2 · Δ3)
--     INSERT ตารางใหม่อย่างเดียว — ไม่ UPDATE step_artifact (clip_brief ยังอยู่ครบ UI เดิมอ่านได้ ·
--     ไม่ยิง trg_step_artifact_updated_at · trap #19 ไม่เกี่ยว)
--     label: ตำแหน่ง 1→A · 2→B เฉพาะ artifact ที่มี hook 2 ตัวพอดี (ของจริงทุกตัวมี 2) ไม่งั้น null ไม่เดา
--     hook_type: ใช้ค่าเดิมเมื่ออยู่ใน 8 ค่า ไม่งั้น null + เก็บค่าเดิมใน hook_type_raw (trap #13: ใช้
--     jsonb_typeof ไม่ใช่ is null — ค่าอาจเป็น JSON null/[]/ไม่มี key)
--     ด่านกันเดา: step ที่มี artifact-with-hooks มากกว่า 1 ตัว · hook ที่ไม่ใช่ object/ไม่มี line → raise
--     รันซ้ำ: on conflict (step_id, legacy_json_id) do nothing · นับครบทุกรอบ
-- ============================================================================

do $c1hooks$
declare
  v_expected   int;
  v_total      int;
  v_dup_steps  int;
  v_bad        int;
  v_art_before text;
  v_art_after  text;
begin
  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, clip_brief::text, updated_at), E'\n' order by id), ''))
    into v_art_before from analytics.step_artifact;

  select coalesce(sum(jsonb_array_length(a.clip_brief -> 'hooks')), 0)::int into v_expected
    from analytics.step_artifact a
   where jsonb_typeof(a.clip_brief -> 'hooks') = 'array';

  select count(*) into v_dup_steps from (
    select a.step_id from analytics.step_artifact a
     where jsonb_typeof(a.clip_brief -> 'hooks') = 'array' and jsonb_array_length(a.clip_brief -> 'hooks') > 0
     group by a.step_id having count(*) > 1) x;
  if v_dup_steps > 0 then
    raise exception '0158 backfill hook: พบ % step ที่มี artifact ที่มี hooks มากกว่า 1 ตัว — ป้าย A/B กำกวม หยุด ไม่เดา', v_dup_steps;
  end if;

  select count(*) into v_bad
    from analytics.step_artifact a
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(a.clip_brief -> 'hooks') = 'array' then a.clip_brief -> 'hooks' else '[]'::jsonb end) as h(elem)
   where jsonb_typeof(h.elem) <> 'object'
      or jsonb_typeof(h.elem -> 'line') is distinct from 'string'
      or length(btrim(h.elem ->> 'line')) not between 1 and 500
      or (h.elem ->> 'line') !~ '\S';
  if v_bad > 0 then
    raise exception '0158 backfill hook: พบ % hook ที่ไม่ใช่ object หรือไม่มีข้อความ line (1-500) — หยุด ไม่เดา', v_bad;
  end if;

  insert into analytics.content_hook
    (shop_id, text, hook_type, origin, step_id, label, generated_by, hook_type_raw, legacy_json_id)
  select
    a.shop_id,
    btrim(h.elem ->> 'line'),
    case when h.elem ->> 'hook_type' in
      ('question', 'fact', 'warning', 'process', 'before_after', 'customer_voice', 'direct_live', 'story')
      then h.elem ->> 'hook_type' end,
    'ours',
    a.step_id,
    case when jsonb_array_length(a.clip_brief -> 'hooks') = 2
         then (case h.ord when 1 then 'A' else 'B' end) end,
    case when a.generated_by like 'ai%' then 'ai' else 'human' end,
    h.elem ->> 'hook_type',
    coalesce(nullif(btrim(h.elem ->> 'id'), ''), 'pos' || h.ord)
  from analytics.step_artifact a
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(a.clip_brief -> 'hooks') = 'array' then a.clip_brief -> 'hooks' else '[]'::jsonb end)
    with ordinality as h(elem, ord)
  on conflict (step_id, legacy_json_id) where legacy_json_id is not null do nothing;

  select count(*) into v_total from analytics.content_hook where legacy_json_id is not null;
  if v_total <> v_expected then
    raise exception '0158 backfill hook: ย้ายได้ % แถว แต่ clip_brief มี % hook — ข้อมูลไม่ครบ (id ซ้ำใน artifact เดียว?)',
      v_total, v_expected;
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, clip_brief::text, updated_at), E'\n' order by id), ''))
    into v_art_after from analytics.step_artifact;
  if v_art_before is distinct from v_art_after then
    raise exception '0158 backfill hook: step_artifact เปลี่ยนระหว่าง backfill (clip_brief/updated_at) — ห้ามเกิด';
  end if;

  raise notice '0158 backfill hook: ย้ายแล้ว % แถว (คาด %) · clip_brief ไม่ถูกแตะ', v_total, v_expected;
end
$c1hooks$;

-- ============================================================================
-- 15. seed live_host 2 แถว (§9.1 Q1) — shop_id query ตอน apply ไม่ hardcode · >1 ร้าน raise
--     0 ร้าน (DB เปล่า/replay): ข้ามพร้อม NOTICE — ไม่ raise เพื่อไม่บล็อกการ rebuild
-- ============================================================================

do $c1seed$
declare
  v_n     int;
  v_shop  uuid;
begin
  select count(*) into v_n from public.shop;
  if v_n > 1 then
    raise exception '0158 seed live_host: พบ % ร้านใน public.shop — ต้องมีร้านเดียวถึงจะ seed อัตโนมัติ หยุด ไม่เดา', v_n;
  end if;
  if v_n = 0 then
    raise notice '0158 seed live_host: ไม่มีร้านใน public.shop — ข้าม seed';
    return;
  end if;
  select id into v_shop from public.shop;

  insert into analytics.live_host (shop_id, display_name, public_label)
  values (v_shop, 'หมีเนย', 'โฮสต์ A'),
         (v_shop, 'ฮันนี้ ปิ๊กๆ', 'โฮสต์ B')
  on conflict do nothing;

  if (select count(*) from analytics.live_host
       where shop_id = v_shop
         and ((lower(display_name) = 'หมีเนย' and public_label = 'โฮสต์ A')
           or (lower(display_name) = 'ฮันนี้ ปิ๊กๆ' and public_label = 'โฮสต์ B'))) <> 2 then
    raise exception '0158 seed live_host: seed ไม่ครบ 2 แถว (มีแถวชื่อเดิมแต่ป้ายต่าง?) — ตรวจ analytics.live_host';
  end if;
end
$c1seed$;

-- ============================================================================
-- 16. ด่านท้ายไฟล์ — ของเดิมต้องไม่ขยับ + ผลลัพธ์ต้องถูก (raise = ถอยทั้งก้อน)
-- ============================================================================

do $c1final$
declare
  v_now text;
  v_bad text;
  v_k   text;
begin
  -- snapshot ต้องอยู่ครบ: set_config(..., true) หมดอายุพร้อมทรานแซกชัน · อ่านด้วย current_setting(..., true) แล้วเช็คเอง
  -- (GUC แบบ custom ที่เคยตั้งแล้วหมดอายุจะกลับเป็น '' ไม่ใช่ null ⇒ เช็คทั้งสองแบบ) — ไม่งั้น "ไม่มีอะไรให้เทียบ"
  -- จะผ่านเป็นเขียว หรือ error เป็น 42704 ที่ไม่บอกสาเหตุ
  foreach v_k in array array['c1.snap_live', 'c1.snap_artifact', 'c1.snap_step', 'c1.snap_post', 'c1.snap_views', 'c1.snap_funcs'] loop
    if coalesce(current_setting(v_k, true), '') = '' then
      raise exception '0158 ด่านท้าย: ไม่พบ snapshot % — ไฟล์นี้ต้องรันทั้งไฟล์ในทรานแซกชันเดียวผ่าน scripts/run-sql.mjs เท่านั้น (อย่าวางทีละก้อน)', v_k;
    end if;
  end loop;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, shop_id, live_date, started_at, ended_at,
           peak_viewers, note, source, created_by, updated_by, created_at, updated_at), E'\n' order by id), ''))
    into v_now from analytics.live_session_log;
  if v_now is distinct from current_setting('c1.snap_live', true) then
    raise exception '0158 ด่านท้าย: live_session_log เดิมเปลี่ยน (ก่อน % / หลัง %)', current_setting('c1.snap_live', true), v_now;
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, status, content_body,
           clip_brief::text, updated_at), E'\n' order by id), ''))
    into v_now from analytics.step_artifact;
  if v_now is distinct from current_setting('c1.snap_artifact', true) then
    raise exception '0158 ด่านท้าย: step_artifact เปลี่ยน (clip_brief ต้องไม่ถูกแตะ)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), E'\n' order by id), ''))
    into v_now from analytics.campaign_step;
  if v_now is distinct from current_setting('c1.snap_step', true) then
    raise exception '0158 ด่านท้าย: campaign_step เปลี่ยน (status/updated_at ต้องไม่ขยับ)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), E'\n' order by id), ''))
    into v_now from analytics.content_post;
  if v_now is distinct from current_setting('c1.snap_post', true) then
    raise exception '0158 ด่านท้าย: content_post เปลี่ยน';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    into v_now
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v'
     and c.relname not in ('v_content_signal', 'v_live_log_recent');
  if v_now is distinct from current_setting('c1.snap_views', true) then
    raise exception '0158 ด่านท้าย: definition ของ view เดิมเปลี่ยน (trap #3 — ห้ามแตะ view เดิม)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
           order by p.oid::regprocedure::text), ''))
    into v_now
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and p.proname !~ '^(content_signal_|content_hook_|content_actor_|content_text_|content_url_|live_host_|live_session_upsert$)';
  if v_now is distinct from current_setting('c1.snap_funcs', true) then
    raise exception '0158 ด่านท้าย: มีฟังก์ชันเดิมที่ไม่ใช่ของไฟล์นี้ถูกเปลี่ยน/เพิ่ม/หาย';
  end if;

  -- trap #1: live_session_upsert ต้องเหลือ signature เดียว
  if (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'live_session_upsert') <> 1 then
    raise exception '0158 ด่านท้าย: live_session_upsert มี overload ค้าง — หยุดแล้วรายงาน';
  end if;

  -- trap #18: ฟังก์ชันของไฟล์นี้ต้องไม่มี PUBLIC/anon/authenticated ถือ EXECUTE
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'analytics'::regnamespace
     and p.proname ~ '^(content_signal_|content_hook_|content_actor_|content_text_|content_url_|live_host_|live_session_upsert$)'
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0158 ด่านท้าย: grant รั่ว (PUBLIC/anon/authenticated) บน %', v_bad;
  end if;

  -- RLS ต้องเปิดทุกตาราง
  select string_agg(c.relname, ', ') into v_bad from pg_class c
   where c.relnamespace = 'analytics'::regnamespace
     and c.relname in ('live_host', 'content_signal', 'content_hook') and not c.relrowsecurity;
  if v_bad is not null then
    raise exception '0158 ด่านท้าย: ตารางไม่ได้เปิด RLS: %', v_bad;
  end if;

  raise notice '0158 ด่านท้าย: ผ่าน — ของเดิมไม่ขยับ · live_session_upsert 1 signature · grant สะอาด · RLS เปิด';
end
$c1final$;

-- ให้ PostgREST รู้จักฟังก์ชัน/ตารางใหม่ทันที (แบบเดียวกับ 0150-0157) — ใน dry-run ที่ ROLLBACK ไม่ถูกส่งออกไป
notify pgrst, 'reload schema';
