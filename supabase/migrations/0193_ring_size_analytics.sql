-- 0193_ring_size_analytics.sql
-- เก็บข้อมูลการใช้เครื่องมือวัดไซส์แหวน /ring-size แบบไม่ระบุตัวตน (design:
-- docs/3j-jewelry/oms/design-ring-size-analytics.md §3 · มติเจ้าของ 25 ต.ค. 69 §12.1:
-- retention 180 วัน · circuit breaker 300 แถวใหม่/10 นาที/ร้าน · เคารพ DNT ฝั่ง client)
--
-- Additive only: create table/function ใหม่ล้วน ไม่แตะตาราง/ฟังก์ชันเดิมแม้แต่บรรทัดเดียว
-- (ไม่มี UPDATE/ALTER ตารางอื่น — กับดัก #19 จึงไม่เกี่ยว)
--
-- ============================================================================
-- 🔴 กฎที่สำคัญที่สุดของไฟล์นี้: analytics.ring_size_session ห้ามมีคอลัมน์
-- IP / IP hash / user-agent ดิบ / cookie / device id / ข้อความอิสระ / ชื่อ / เบอร์โทร / LINE
-- เด็ดขาด — session id คือ uuid ที่ client สุ่มเองและตายพร้อมแท็บ ทุกค่าที่เก็บเป็นรหัส/ตัวเลขที่
-- RPC บังคับ allowlist · verify-0193 T01 ล็อกรายชื่อคอลัมน์แบบเป๊ะ (เพิ่มคอลัมน์ = เทสต์ล้ม)
--
-- รูปแบบข้อมูล: 1 แถว = การเปิดเครื่องมือ 1 ครั้ง (snapshot ที่ upsert แบบ monotonic)
-- ไม่ใช่ event log — ขนาดข้อมูลต่อ session มีเพดานโดยโครงสร้าง (event_count ≤ 40) กันสแปม
--
-- เลขไฟล์: main มีถึง 0191 · 0192 อยู่บน branch feature/g1b-gems-to-buy (ยังไม่ merge) ⇒ ใช้ 0193
-- ตามที่ design สั่ง · ถ้า 0192 merge ก่อน ไม่ชนกัน (คนละชื่อ/คนละออบเจกต์)
--
-- Grant model (3j-migration-traps #18): สคีมา analytics ปิด USAGE ให้ anon/authenticated ทั้งสคีมา
-- ตั้งแต่ 0123 ⇒ ทุกออบเจกต์ใหม่ grant ให้ service_role อย่างเดียว · ALTER DEFAULT PRIVILEGES แจก
-- ALL (รวม MAINTAIN) ให้ service_role บนตารางใหม่ทุกตัวอัตโนมัติ (บทเรียน 0155/0156) ⇒ revoke
-- ส่วนเกินในไฟล์เดียวกันนี้เลย ไม่ต้องออก migration ซ้ำ
--   - ตาราง session: ไม่มี INSERT/UPDATE/DELETE ให้ใครเลย (รวม service_role) · ทางเขียนทางเดียว
--     คือ ring_size_session_upsert (security definer · เจ้าของฟังก์ชัน = เจ้าของตาราง)
--   - revoke maintain ต้องใช้ Postgres 17+ (เหมือน 0156 ที่ลงบน prod แล้ว)
--
-- ค่าคงที่ที่อยู่ 2 ที่ (ต้องแก้คู่เสมอ):
--   · ช่วงเบอร์ร้าน 45-68 : analytics.ring_size_shop_range() ⇔ SHOP_RING_SIZES ใน lib/ring-size/config.ts
--   · allowlist ของ snapshot : v_allowed ในฟังก์ชัน upsert ⇔ lib/ring-size/track-schema.ts
--   · cap 40 event/session และ 300/10 นาที : ฟังก์ชัน upsert ⇔ route handler ไม่รู้ค่านี้ (แค่ map 429)

set local lock_timeout = '8s';

-- ============================================================================
-- 1. (ตัดออก — มติเจ้าของ 25 ต.ค. 69) ไม่แยกช่องทาง ?src= ในรอบนี้: ไม่มีตาราง lookup ช่องทาง ไม่มีคอลัมน์ src
--    ไม่มี p_src ใน stats · "ยังไม่มีช่องทางเยอะ เก็บข้อมูลยาก" · คง in_app (bucket จาก user-agent ได้อัตโนมัติ
--    ไม่ต้องแปะลิงก์แยก) · อยากเพิ่มช่องทางทีหลัง = migration ใหม่ (add column + lookup) ไม่ต้องเผื่อคอลัมน์ว่าง
-- ============================================================================

-- ============================================================================
-- 2. analytics.ring_size_session — 1 แถว/session
-- ============================================================================

create table if not exists analytics.ring_size_session (
  id             uuid primary key,
  shop_id        uuid not null references public.shop (id) on delete cascade,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  in_app         text not null default 'unknown'
                   check (in_app in ('line', 'tiktok', 'fb', 'ig', 'browser', 'unknown')),
  is_return      boolean not null default false,
  max_stage      smallint not null default 0 check (max_stage between 0 and 7),
  ref            text check (ref in ('card', 'coin')),
  method         text check (method in ('A', 'B')),
  -- ค่าปัด 0.1 ของผลล่าสุด · ไม่เก็บ px/ppm/dpr ดิบ
  circ_mm        numeric(4, 1) check (circ_mm between 20 and 120),
  result_size    smallint check (result_size between 30 and 90),
  is_between     boolean,
  -- RPC คำนวณจาก result_size เทียบ ring_size_shop_range() เอง ไม่เชื่อ client
  in_shop_range  boolean,
  measure_count  smallint not null default 0 check (measure_count between 0 and 50),
  invalid_count  smallint not null default 0 check (invalid_count between 0 and 50),
  zoom_blocked   boolean not null default false,
  calib_warn     boolean not null default false,
  stale_recalib  boolean not null default false,
  -- เคยเข้าหน้าวัดของวิธีนั้น (stage >= 6 ขณะ method = นั้น) · OR monotonic — method ด้านบนเป็นค่าล่าสุดทับ
  -- ลองกระดาษแล้วเปลี่ยนไปแหวนเดิม method จะเหลือ A แต่ used_b ยังจำไว้ (เก็บย้อนหลังไม่ได้ จึงเพิ่มก่อนตารางเกิด)
  used_a         boolean not null default false,
  used_b         boolean not null default false,
  -- เคยได้ผลก้ำกึ่งระหว่างเบอร์ (วิธี B) แม้ผลล่าสุดจะไม่ก้ำกึ่งแล้ว · OR
  saw_between    boolean not null default false,
  cta_line       boolean not null default false,
  cta_share      boolean not null default false,
  cta_shop       boolean not null default false,
  cta_gem_quiz   boolean not null default false,
  event_count    smallint not null default 0 check (event_count between 0 and 40)
);

comment on table analytics.ring_size_session is
  'เครื่องมือวัดไซส์แหวน /ring-size — 1 แถว/การเปิดใช้ 1 ครั้ง (upsert แบบ monotonic: stage = greatest, '
  'ธง = OR, ค่าวัด = ล่าสุดทับ). 🔴 จงใจไม่มีคอลัมน์ IP/IP hash/user-agent ดิบ/cookie/device id/'
  'ข้อความอิสระ/ชื่อ/เบอร์โทร/LINE (มติเจ้าของ: ไม่ระบุตัวตน) — id คือ uuid ที่ client สุ่มและตายพร้อมแท็บ. '
  'ไม่มี INSERT/UPDATE/DELETE grant ให้ role ใดเลย (รวม service_role) — ทางเขียนทางเดียวคือ '
  'ring_size_session_upsert. retention 180 วัน (ring_size_retention_apply + pg_cron).';
comment on column analytics.ring_size_session.method is
  'วิธีวัดล่าสุดที่ session นี้เลือก (ล่าสุดทับ) — ไม่ใช่ "เคยใช้วิธีไหน": ดู used_a/used_b';
comment on column analytics.ring_size_session.used_a is
  'เคยเข้าหน้าวัดของวิธีแหวนวงเดิม (A) — OR monotonic · RPC derive จาก stage>=6 + method (หรือ client ส่ง used_a=true)';
comment on column analytics.ring_size_session.used_b is
  'เคยเข้าหน้าวัดของวิธีกระดาษพันนิ้ว (B) — OR monotonic · เหตุผลเดียวกับ used_a';
comment on column analytics.ring_size_session.saw_between is
  'เคยได้ผลก้ำกึ่งระหว่างเบอร์ (is_between=true ในผลวัดใด ๆ) — OR monotonic ต่างจาก is_between ที่เป็นผลล่าสุด';
comment on column analytics.ring_size_session.cta_line is
  'กดปุ่ม LINE อย่างน้อย 1 ครั้ง — นับรวมทุกจุดที่ client ส่ง cta=line (ปุ่มหลักหน้าผลลัพธ์ + ทางสำรอง/หน้าช่วยเหลือ) DB ไม่แยกจุด · ขั้นต่ำ (sendBeacon อาจหลุด)';
comment on column analytics.ring_size_session.max_stage is
  '0 view · 1 start · 2 calib_pick · 3 calib_adjust · 4 calib_done · 5 method_pick · 6 measure · '
  '7 result (R6 หรือ G4) — คนกลับมาข้ามขั้นได้ (กระโดด 1→5)';
comment on column analytics.ring_size_session.in_shop_range is
  'คำนวณใน DB จาก result_size เทียบ analytics.ring_size_shop_range() — ค่า in_range ที่ client ส่งมาถูกทิ้ง';
comment on column analytics.ring_size_session.is_between is
  'เฉพาะวิธี B (กระดาษ) — ตัวแปรชื่อ between ใน snapshot (between เป็นคำสงวนของ SQL จึงตั้งชื่อคอลัมน์ is_between)';
comment on column analytics.ring_size_session.event_count is
  'จำนวนครั้งที่ upsert แถวนี้ — เพดาน 40 (ครั้งที่ 41 ⇒ P0001) กัน sid เดียวยิงไม่จำกัด';

create index if not exists idx_ring_size_session_shop_created
  on analytics.ring_size_session (shop_id, created_at desc);

alter table analytics.ring_size_session enable row level security;

drop policy if exists tenant_isolation_select on analytics.ring_size_session;
create policy tenant_isolation_select on analytics.ring_size_session
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

revoke all on analytics.ring_size_session from public, anon, authenticated;
grant select on analytics.ring_size_session to service_role;
revoke insert, update, delete, truncate, references, trigger, maintain
  on analytics.ring_size_session from service_role;

-- ============================================================================
-- 3. analytics.ring_size_shop_range() — ช่วงเบอร์ที่ร้านทำ (แหล่งเดียวใน DB)
--    ⇔ SHOP_RING_SIZES { min: 45, max: 68 } ใน lib/ring-size/config.ts — เปลี่ยนต้องแก้คู่
--    int4range canonical = [45,69) (upper exclusive) — ผู้ใช้ใช้ @> / lower() / upper() เท่านั้น
-- ============================================================================

drop function if exists analytics.ring_size_shop_range();
create function analytics.ring_size_shop_range() returns int4range
  language sql
  immutable
as $$select int4range(45, 68, '[]')$$;

comment on function analytics.ring_size_shop_range() is
  'ช่วงเบอร์แหวนที่ร้านมีขาย [45,68] — ต้องตรงกับ SHOP_RING_SIZES ใน lib/ring-size/config.ts (แก้คู่เสมอ). '
  'ใช้โดย ring_size_session_upsert (in_shop_range) และ ring_size_stats (below/in/above).';

revoke execute on function analytics.ring_size_shop_range() from public, anon, authenticated;
grant execute on function analytics.ring_size_shop_range() to service_role;

-- ============================================================================
-- 4. analytics.ring_size_session_upsert — RPC สาธารณะ (เรียกจาก app/api/ring-size/event/route.ts
--    ด้วย service role หลังผ่านด่าน same-origin/body size/allowlist ของ route แล้ว)
--
-- 🔴 ไม่เรียก crm_require_owner_admin โดยตั้งใจ (เป็น RPC สาธารณะ · ด่านสิทธิ์จริง = grant service_role
-- เท่านั้น) · ไม่เชื่อ caller แม้ route จะตรวจมาแล้ว — ตรวจ allowlist/ชนิด/ช่วงซ้ำทุกข้อ (defense-in-depth)
-- errcode: validation ผิด / shop ไม่ตรง = 22023 · เกิน event_count หรือ circuit breaker = P0001
--
-- ด่านแต่ละตัวมี marker [mut:..] ให้ verify-0193 สร้าง mutant (ตัดด่านออกชั่วคราวในทรานแซกชันที่ rollback)
-- พิสูจน์ว่าเทสต์ล้มจริงเมื่อด่านหาย — ห้ามเปลี่ยนข้อความบรรทัดที่มี marker โดยไม่แก้ verify
-- ============================================================================

drop function if exists analytics.ring_size_session_upsert(uuid, uuid, jsonb);

create function analytics.ring_size_session_upsert(
  p_shop_id uuid,
  p_session_id uuid,
  p_snapshot jsonb
) returns void
  language plpgsql
  security definer
  set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  -- cap ของ circuit breaker: 300 แถวใหม่ต่อร้านใน 10 นาที (มติเจ้าของ 25 ต.ค. 69 O4: broadcast LINE ≤ 1,000 คน)
  v_cap constant int := 300;
  v_max_events constant int := 40;
  v_allowed constant text[] := array[
    'in_app', 'is_return', 'stage', 'ref', 'method', 'circ_mm', 'size', 'between',
    'in_range', 'g1', 'g3', 'g4', 'g5', 'cta', 'used_a', 'used_b', 'saw_between'
  ];

  v_key text;
  v_num numeric;
  v_stage smallint;
  v_in_app text;
  v_is_return boolean;
  v_ref text;
  v_method text;
  v_circ numeric(4, 1);
  v_size smallint;
  v_between boolean;
  v_g1 boolean;
  v_g3 boolean;
  v_g4 boolean;
  v_g5 boolean;
  v_cta text;
  v_used_a boolean;
  v_used_b boolean;
  v_saw_between boolean;

  v_has_result boolean;
  v_counts_measure boolean;
  v_final_size smallint;

  v_old analytics.ring_size_session%rowtype;
  v_old_found boolean;
  v_window_count int;
  v_rows int;
  v_attempt int;
begin
  -- 1. ทุกพารามิเตอร์เป็นค่าจำเป็น + snapshot ต้องเป็น JSON object
  --    (#13: เช็ค jsonb_typeof ห้ามใช้ is not null กับ jsonb — JSON null ผ่าน is not null เสมอ)
  if p_shop_id is null or p_session_id is null or p_snapshot is null then
    raise exception 'ring_size_session_upsert: ทุกพารามิเตอร์เป็นค่าจำเป็น' using errcode = '22023';
  end if;
  if jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'ring_size_session_upsert: snapshot ต้องเป็น JSON object' using errcode = '22023';
  end if;

  -- 2. allowlist ของ key (ไม่ echo ชื่อ key ที่ client ส่งมากลับใน message)
  if (select count(*) from jsonb_object_keys(p_snapshot)) > 20 then
    raise exception 'ring_size_session_upsert: snapshot มี key มากเกินไป' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_snapshot) loop
    if not (v_key = any (v_allowed)) then -- [mut:allowlist]
      raise exception 'ring_size_session_upsert: snapshot มี key นอก allowlist' using errcode = '22023';
    end if;
  end loop;

  -- 3. ชนิด/ช่วงของแต่ละ key — ตัวเลขใช้ not(between) ฆ่า NaN/Infinity/ค่าล้นให้ฟรี (#4)
  if jsonb_typeof(p_snapshot -> 'stage') is distinct from 'number' then
    raise exception 'ring_size_session_upsert: stage จำเป็นและต้องเป็นตัวเลข' using errcode = '22023';
  end if;
  v_num := (p_snapshot ->> 'stage')::numeric;
  if not (v_num between 0 and 7 and v_num = trunc(v_num)) then
    raise exception 'ring_size_session_upsert: stage ต้องเป็นจำนวนเต็ม 0-7' using errcode = '22023';
  end if;
  v_stage := v_num::smallint;

  if p_snapshot ? 'in_app' then
    if jsonb_typeof(p_snapshot -> 'in_app') is distinct from 'string'
       or not coalesce((p_snapshot ->> 'in_app') = any (array['line', 'tiktok', 'fb', 'ig', 'browser', 'unknown']), false) then
      raise exception 'ring_size_session_upsert: in_app ไม่ถูกต้อง' using errcode = '22023';
    end if;
    v_in_app := p_snapshot ->> 'in_app';
  end if;

  if p_snapshot ? 'ref' then
    if jsonb_typeof(p_snapshot -> 'ref') is distinct from 'string'
       or not coalesce((p_snapshot ->> 'ref') = any (array['card', 'coin']), false) then
      raise exception 'ring_size_session_upsert: ref ไม่ถูกต้อง' using errcode = '22023';
    end if;
    v_ref := p_snapshot ->> 'ref';
  end if;

  if p_snapshot ? 'method' then
    if jsonb_typeof(p_snapshot -> 'method') is distinct from 'string'
       or not coalesce((p_snapshot ->> 'method') = any (array['A', 'B']), false) then
      raise exception 'ring_size_session_upsert: method ไม่ถูกต้อง' using errcode = '22023';
    end if;
    v_method := p_snapshot ->> 'method';
  end if;

  if p_snapshot ? 'cta' then
    if jsonb_typeof(p_snapshot -> 'cta') is distinct from 'string'
       or not coalesce((p_snapshot ->> 'cta') = any (array['line', 'share', 'shop', 'gem_quiz']), false) then
      raise exception 'ring_size_session_upsert: cta ไม่ถูกต้อง' using errcode = '22023';
    end if;
    v_cta := p_snapshot ->> 'cta';
  end if;

  if p_snapshot ? 'circ_mm' then
    if jsonb_typeof(p_snapshot -> 'circ_mm') is distinct from 'number' then
      raise exception 'ring_size_session_upsert: circ_mm ต้องเป็นตัวเลข' using errcode = '22023';
    end if;
    v_num := (p_snapshot ->> 'circ_mm')::numeric;
    if not (v_num between 20 and 120) then
      raise exception 'ring_size_session_upsert: circ_mm ต้องอยู่ 20-120' using errcode = '22023';
    end if;
    v_circ := round(v_num, 1);
  end if;

  if p_snapshot ? 'size' then
    if jsonb_typeof(p_snapshot -> 'size') is distinct from 'number' then
      raise exception 'ring_size_session_upsert: size ต้องเป็นตัวเลข' using errcode = '22023';
    end if;
    v_num := (p_snapshot ->> 'size')::numeric;
    if not (v_num between 30 and 90 and v_num = trunc(v_num)) then
      raise exception 'ring_size_session_upsert: size ต้องเป็นจำนวนเต็ม 30-90' using errcode = '22023';
    end if;
    v_size := v_num::smallint;
  end if;

  -- ธง boolean ทั้งหมด: ต้องเป็น JSON boolean จริง (ไม่รับ "true"/1)
  -- in_range ถูกตรวจชนิดแต่ทิ้งค่า — in_shop_range คำนวณใน DB เองจาก size
  if p_snapshot ? 'is_return' then
    if jsonb_typeof(p_snapshot -> 'is_return') is distinct from 'boolean' then
      raise exception 'ring_size_session_upsert: is_return ต้องเป็น boolean' using errcode = '22023';
    end if;
    v_is_return := (p_snapshot ->> 'is_return')::boolean;
  end if;
  if p_snapshot ? 'between' then
    if jsonb_typeof(p_snapshot -> 'between') is distinct from 'boolean' then
      raise exception 'ring_size_session_upsert: between ต้องเป็น boolean' using errcode = '22023';
    end if;
    v_between := (p_snapshot ->> 'between')::boolean;
  end if;
  if p_snapshot ? 'in_range' then
    if jsonb_typeof(p_snapshot -> 'in_range') is distinct from 'boolean' then
      raise exception 'ring_size_session_upsert: in_range ต้องเป็น boolean' using errcode = '22023';
    end if;
  end if;
  if p_snapshot ? 'g1' then
    if jsonb_typeof(p_snapshot -> 'g1') is distinct from 'boolean' then
      raise exception 'ring_size_session_upsert: g1 ต้องเป็น boolean' using errcode = '22023';
    end if;
    v_g1 := (p_snapshot ->> 'g1')::boolean;
  end if;
  if p_snapshot ? 'g3' then
    if jsonb_typeof(p_snapshot -> 'g3') is distinct from 'boolean' then
      raise exception 'ring_size_session_upsert: g3 ต้องเป็น boolean' using errcode = '22023';
    end if;
    v_g3 := (p_snapshot ->> 'g3')::boolean;
  end if;
  if p_snapshot ? 'g4' then
    if jsonb_typeof(p_snapshot -> 'g4') is distinct from 'boolean' then
      raise exception 'ring_size_session_upsert: g4 ต้องเป็น boolean' using errcode = '22023';
    end if;
    v_g4 := (p_snapshot ->> 'g4')::boolean;
  end if;
  if p_snapshot ? 'g5' then
    if jsonb_typeof(p_snapshot -> 'g5') is distinct from 'boolean' then
      raise exception 'ring_size_session_upsert: g5 ต้องเป็น boolean' using errcode = '22023';
    end if;
    v_g5 := (p_snapshot ->> 'g5')::boolean;
  end if;

  if p_snapshot ? 'used_a' then
    if jsonb_typeof(p_snapshot -> 'used_a') is distinct from 'boolean' then
      raise exception 'ring_size_session_upsert: used_a ต้องเป็น boolean' using errcode = '22023';
    end if;
    v_used_a := (p_snapshot ->> 'used_a')::boolean;
  end if;
  if p_snapshot ? 'used_b' then
    if jsonb_typeof(p_snapshot -> 'used_b') is distinct from 'boolean' then
      raise exception 'ring_size_session_upsert: used_b ต้องเป็น boolean' using errcode = '22023';
    end if;
    v_used_b := (p_snapshot ->> 'used_b')::boolean;
  end if;
  if p_snapshot ? 'saw_between' then
    if jsonb_typeof(p_snapshot -> 'saw_between') is distinct from 'boolean' then
      raise exception 'ring_size_session_upsert: saw_between ต้องเป็น boolean' using errcode = '22023';
    end if;
    v_saw_between := (p_snapshot ->> 'saw_between')::boolean;
  end if;

  -- ผลวัดเป็นก้อนเดียว (circ · size · between ไปด้วยกัน): มี circ หรือ size ใน snapshot นี้ = ทับทั้งก้อน
  -- นับรอบวัดเมื่อถึง stage 7 พร้อมเบอร์ (G4 ถึง stage 7 แต่ไม่มีเบอร์ ⇒ ไม่นับ)
  v_has_result := v_circ is not null or v_size is not null;
  v_counts_measure := v_stage = 7 and v_size is not null;

  -- 4. upsert: อ่านแถวเดิมแบบ for update ก่อน — ถ้าไม่มีค่อย insert ... on conflict do nothing
  --    (แพ้ race กับอีก request ของ sid เดียวกัน ⇒ วนกลับไปเข้าทางแก้แถวเดิม · ไม่ใช้ on conflict do update
  --    เพราะต้อง raise P0001/22023 ตามเงื่อนไขแถวเดิม — แทนที่จะกลืนเงียบด้วย where)
  for v_attempt in 1..2 loop
    select * into v_old from analytics.ring_size_session where id = p_session_id for update;
    v_old_found := found;

    if v_old_found then
      if v_old.shop_id <> p_shop_id then -- [mut:shop]
        raise exception 'ring_size_session_upsert: session นี้เป็นของร้านอื่น' using errcode = '22023';
      end if;
      if v_old.event_count >= v_max_events then -- [mut:events]
        raise exception 'ring_size_session_upsert: session นี้ส่งเกินจำนวนที่รับได้' using errcode = 'P0001';
      end if;

      v_final_size := case when v_has_result then v_size else v_old.result_size end;

      update analytics.ring_size_session s
      set updated_at    = now(),
          in_app        = case when s.in_app = 'unknown' and v_in_app is not null then v_in_app else s.in_app end,
          is_return     = s.is_return or coalesce(v_is_return, false),
          max_stage     = greatest(s.max_stage, v_stage), -- [mut:monotonic]
          ref           = coalesce(v_ref, s.ref),
          method        = coalesce(v_method, s.method),
          circ_mm       = case when v_has_result then v_circ else s.circ_mm end,
          result_size   = v_final_size,
          is_between    = case when v_has_result then v_between else s.is_between end,
          in_shop_range = case when v_final_size is null then null
                               else analytics.ring_size_shop_range() @> v_final_size::int end,
          measure_count = least(s.measure_count + case when v_counts_measure then 1 else 0 end, 50),
          invalid_count = least(s.invalid_count + case when coalesce(v_g4, false) then 1 else 0 end, 50),
          zoom_blocked  = s.zoom_blocked or coalesce(v_g1, false),
          calib_warn    = s.calib_warn or coalesce(v_g3, false),
          stale_recalib = s.stale_recalib or coalesce(v_g5, false),
          -- เข้าหน้าวัด = stage >= 6 ขณะ method (ใหม่หรือเดิม) เป็นวิธีนั้น · OR กับค่าที่ client ส่ง และของเดิม
          used_a        = s.used_a or coalesce(v_used_a, false) or coalesce(v_stage >= 6 and coalesce(v_method, s.method) = 'A', false), -- [mut:used]
          used_b        = s.used_b or coalesce(v_used_b, false) or coalesce(v_stage >= 6 and coalesce(v_method, s.method) = 'B', false),
          saw_between   = s.saw_between or coalesce(v_saw_between, false) or (v_has_result and coalesce(v_between, false)),
          cta_line      = s.cta_line or coalesce(v_cta = 'line', false),
          cta_share     = s.cta_share or coalesce(v_cta = 'share', false),
          cta_shop      = s.cta_shop or coalesce(v_cta = 'shop', false),
          cta_gem_quiz  = s.cta_gem_quiz or coalesce(v_cta = 'gem_quiz', false),
          event_count   = s.event_count + 1
      where s.id = p_session_id;
      return;
    end if;

    -- ไม่มีแถวเดิม ⇒ ด่าน circuit breaker นับเฉพาะ "แถวใหม่" (session ที่มีอยู่แล้วส่งต่อได้ปกติแม้ breaker ทำงาน)
    -- ไม่ lock — ยอมรับ race เกิน cap ได้ไม่กี่แถว (ไม่ใช่เงิน)
    select count(*) into v_window_count
    from analytics.ring_size_session
    where shop_id = p_shop_id and created_at > now() - interval '10 minutes';

    if v_window_count >= v_cap then -- [mut:breaker]
      raise exception 'ring_size_session_upsert: เกินจำนวนที่รับได้ใน 10 นาที' using errcode = 'P0001';
    end if;

    insert into analytics.ring_size_session (
      id, shop_id, in_app, is_return, max_stage, ref, method,
      circ_mm, result_size, is_between, in_shop_range,
      measure_count, invalid_count, zoom_blocked, calib_warn, stale_recalib,
      used_a, used_b, saw_between,
      cta_line, cta_share, cta_shop, cta_gem_quiz, event_count
    ) values (
      p_session_id, p_shop_id, coalesce(v_in_app, 'unknown'), coalesce(v_is_return, false), v_stage, v_ref, v_method,
      v_circ, v_size, case when v_has_result then v_between end,
      case when v_size is null then null else analytics.ring_size_shop_range() @> v_size::int end,
      case when v_counts_measure then 1 else 0 end,
      case when coalesce(v_g4, false) then 1 else 0 end,
      coalesce(v_g1, false), coalesce(v_g3, false), coalesce(v_g5, false),
      coalesce(v_used_a, false) or coalesce(v_stage >= 6 and v_method = 'A', false),
      coalesce(v_used_b, false) or coalesce(v_stage >= 6 and v_method = 'B', false),
      coalesce(v_saw_between, false) or (v_has_result and coalesce(v_between, false)),
      coalesce(v_cta = 'line', false), coalesce(v_cta = 'share', false),
      coalesce(v_cta = 'shop', false), coalesce(v_cta = 'gem_quiz', false),
      1
    )
    on conflict (id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      return;
    end if;
    -- v_rows = 0: อีก request แทรกก่อน ⇒ รอบถัดไปจะเจอแถวแล้ว
  end loop;

  raise exception 'ring_size_session_upsert: ชนกับ request อื่นของ session เดียวกัน' using errcode = 'P0001';
end;
$$;

comment on function analytics.ring_size_session_upsert(uuid, uuid, jsonb) is
  'RPC สาธารณะ (เรียกจาก app/api/ring-size/event/route.ts ด้วย service role เท่านั้น — ไม่มีด่าน owner/admin '
  'โดยตั้งใจ ดูหัวไฟล์ 0193). 1 แถว/session upsert แบบ monotonic: max_stage=greatest · ธง=OR · ref/method=ล่าสุดทับ · '
  'ผลวัด (circ/size/between)=ล่าสุดทับเป็นก้อน · used_a/used_b/saw_between=OR (derive จาก stage>=6+method และ client ส่งได้) · in_shop_range คำนวณใน DB · measure_count +1 เมื่อ stage 7 มีเบอร์. '
  'errcode: validation ผิด/session ของร้านอื่น=22023 · event_count เกิน 40 หรือแถวใหม่เกิน 300/10 นาที/ร้าน=P0001.';

revoke execute on function analytics.ring_size_session_upsert(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function analytics.ring_size_session_upsert(uuid, uuid, jsonb)
  to service_role;

-- ============================================================================
-- 5. analytics.ring_size_stats — RPC สำหรับหน้าสรุปเจ้าของ (P3) · คืน jsonb ก้อนเดียว
--    (ไม่ใช่ returns table: #12 + PostgREST ตัดที่ max-rows 1000 เงียบ)
--    วันไทย inclusive ทั้งสองด้าน (#6) · ไม่คืนแถวดิบ (ลดความเสี่ยงจับคู่กับเวลาที่ลูกค้าทัก LINE)
-- ============================================================================

drop function if exists analytics.ring_size_stats(uuid, date, date);

create function analytics.ring_size_stats(
  p_shop_id uuid,
  p_from date,
  p_to date
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_result jsonb;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
begin
  if p_shop_id is null or p_from is null or p_to is null then
    raise exception 'ring_size_stats: p_shop_id/p_from/p_to เป็นค่าจำเป็น' using errcode = '22023';
  end if;

  -- ด่านสิทธิ์ก่อน validate ช่วงวัน (กัน probe ด้วยพารามิเตอร์ก่อนรู้ว่าไม่มีสิทธิ์)
  perform analytics.crm_require_owner_admin(p_shop_id); -- [mut:owner]

  if p_from > p_to then
    raise exception 'ring_size_stats: p_from ต้องไม่เกิน p_to' using errcode = '22023';
  end if;
  -- เพดาน 180 วัน (p_to - p_from <= 180) ให้ตรงกับ retention 180 วัน — เกินนั้นไม่มีข้อมูลให้ดูอยู่แล้ว
  if (p_to - p_from) > 180 then
    raise exception 'ring_size_stats: ช่วงวันที่เกิน 180 วัน' using errcode = '22023';
  end if;
  v_from_ts := p_from::timestamp at time zone 'Asia/Bangkok';
  v_to_ts   := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';

  with scoped as (
    select r.*
    from analytics.ring_size_session r
    where r.shop_id = p_shop_id
      and r.created_at >= v_from_ts
      and r.created_at < v_to_ts
  )
  select jsonb_build_object(
    'sessions',  (select count(*) from scoped),
    'returning', (select count(*) from scoped where is_return),
    'measured',  (select count(*) from scoped where result_size is not null),

    -- ช่วงเบอร์ร้าน (แหล่งเดียวกับ in_shop_range) — UI ห้าม hardcode 45/68
    'shop_range', jsonb_build_object(
      'min', lower(analytics.ring_size_shop_range()),
      'max', upper(analytics.ring_size_shop_range()) - 1
    ),
    -- วันไทยของแถวแรกสุดที่ยังอยู่ของร้านนี้ (ไม่ขึ้นกับช่วงวัน; null = ยังไม่มีข้อมูลเลย) — retention 180 วันทำให้เลื่อนไปข้างหน้าได้
    'data_since', (
      select to_char((min(d.created_at) at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD')
      from analytics.ring_size_session d where d.shop_id = p_shop_id
    ),

    'by_in_app', jsonb_build_object(
      'line',    (select count(*) from scoped where in_app = 'line'),
      'tiktok',  (select count(*) from scoped where in_app = 'tiktok'),
      'fb',      (select count(*) from scoped where in_app = 'fb'),
      'ig',      (select count(*) from scoped where in_app = 'ig'),
      'browser', (select count(*) from scoped where in_app = 'browser'),
      'unknown', (select count(*) from scoped where in_app = 'unknown')
    ),

    -- funnel[k] = จำนวน session ที่ไปถึงขั้น k ขึ้นไป (k = 0..7) · abandon_at[k] = หยุดที่ขั้น k พอดี (k = 0..6)
    -- invariant: sum(abandon_at) + funnel[7] = sessions
    'funnel', (
      select jsonb_agg(f.n order by f.k)
      from (select g.k, (select count(*) from scoped where max_stage >= g.k) as n
            from generate_series(0, 7) as g(k)) f
    ),
    'abandon_at', (
      select jsonb_agg(f.n order by f.k)
      from (select g.k, (select count(*) from scoped where max_stage = g.k) as n
            from generate_series(0, 6) as g(k)) f
    ),

    'result_sizes', (
      select coalesce(jsonb_agg(jsonb_build_object('size', t.sz, 'count', t.cnt) order by t.sz), '[]'::jsonb)
      from (select sc.result_size as sz, count(*) as cnt
            from scoped sc where sc.result_size is not null group by sc.result_size) t
    ),
    -- ช่วงที่ร้านทำ = analytics.ring_size_shop_range() (แหล่งเดียว) · below/above เทียบขอบของช่วงนั้น
    'size_summary', jsonb_build_object(
      'below_range', (select count(*) from scoped
                      where result_size is not null and result_size < lower(analytics.ring_size_shop_range())),
      'in_range',    (select count(*) from scoped
                      where result_size is not null and analytics.ring_size_shop_range() @> result_size::int),
      'above_range', (select count(*) from scoped
                      where result_size is not null and result_size >= upper(analytics.ring_size_shop_range())),
      'between_count',    (select count(*) from scoped where is_between),
      'invalid_sessions', (select count(*) from scoped where invalid_count > 0)
    ),
    'circ_hist', (
      select coalesce(jsonb_agg(jsonb_build_object('mm', t.mm, 'count', t.cnt) order by t.mm), '[]'::jsonb)
      from (select floor(sc.circ_mm)::int as mm, count(*) as cnt
            from scoped sc where sc.circ_mm is not null group by floor(sc.circ_mm)::int) t
    ),

    -- method{A,B} = จำนวน session แยกตามวิธีที่เลือก "ล่าสุด" (ล่าสุดทับ) · ไม่นับ session ที่ยังไม่เคยเลือกวิธี ·
    -- 🔴 ไม่ใช่ "เคยใช้วิธีไหน" — คนลองกระดาษแล้วเปลี่ยนเป็นแหวนเดิมอยู่ใน A ที่นี่ · ใช้ method_stats แทนเมื่อวิเคราะห์ต่อวิธี
    'method', jsonb_build_object(
      'A', (select count(*) from scoped where method = 'A'),
      'B', (select count(*) from scoped where method = 'B')
    ),
    -- method_stats[x] นับจาก used_x (เคยเข้าหน้าวัดวิธี x) — session ที่ลองทั้งสองวิธีนับ picked/invalid_sessions ทั้งสองฝั่ง:
    --   picked               = used_x
    --   measured             = used_x และวิธีล่าสุด = x และมีเบอร์ (result_size)
    --   abandoned_at_measure = used_x และวิธีล่าสุด = x และ max_stage = 6 (เข้าหน้าวัดแล้วไม่ได้ผล)
    --   invalid_sessions     = used_x และ G4 อย่างน้อย 1 ครั้ง
    --   remeasured           = used_x และวิธีล่าสุด = x และ measure_count >= 2
    --   between              = B เท่านั้น: used_b และเคยได้ผลก้ำกึ่ง (saw_between) · A = null (วิธีแหวนวงเดิมปัดใกล้สุด ไม่มีก้ำกึ่ง)
    -- ข้อจำกัด: วัดด้วย x ได้เบอร์ แล้วย้อนไปเลือกวิธีอื่นแต่ไม่ได้ผลใหม่ ผลเก่านับกับวิธีล่าสุด (ไม่มี result_method)
    'method_stats', jsonb_build_object(
      'A', jsonb_build_object(
        'picked',               (select count(*) from scoped where used_a),
        'measured',             (select count(*) from scoped where used_a and method = 'A' and result_size is not null),
        'abandoned_at_measure', (select count(*) from scoped where used_a and method = 'A' and max_stage = 6),
        'invalid_sessions',     (select count(*) from scoped where used_a and invalid_count > 0),
        'remeasured',           (select count(*) from scoped where used_a and method = 'A' and measure_count >= 2),
        'between',              null
      ),
      'B', jsonb_build_object(
        'picked',               (select count(*) from scoped where used_b),
        'measured',             (select count(*) from scoped where used_b and method = 'B' and result_size is not null),
        'abandoned_at_measure', (select count(*) from scoped where used_b and method = 'B' and max_stage = 6),
        'invalid_sessions',     (select count(*) from scoped where used_b and invalid_count > 0),
        'remeasured',           (select count(*) from scoped where used_b and method = 'B' and measure_count >= 2),
        'between',              (select count(*) from scoped where used_b and saw_between)
      )
    ),
    -- เปลี่ยนวิธี: a_to_b = เคยใช้ A และวิธีล่าสุดเป็น B · b_to_a = เคยใช้ B และวิธีล่าสุดเป็น A (ลองกระดาษแล้วมาแหวนเดิม) · both = ใช้ทั้งสอง
    'switched', jsonb_build_object(
      'a_to_b', (select count(*) from scoped where used_a and method = 'B'),
      'b_to_a', (select count(*) from scoped where used_b and method = 'A'),
      'both',   (select count(*) from scoped where used_a and used_b)
    ),
    'saw_between', (select count(*) from scoped where saw_between),
    'ref', jsonb_build_object(
      'card', (select count(*) from scoped where ref = 'card'),
      'coin', (select count(*) from scoped where ref = 'coin')
    ),
    'method_x_ref', jsonb_build_object(
      'A_card', (select count(*) from scoped where method = 'A' and ref = 'card'),
      'A_coin', (select count(*) from scoped where method = 'A' and ref = 'coin'),
      'B_card', (select count(*) from scoped where method = 'B' and ref = 'card'),
      'B_coin', (select count(*) from scoped where method = 'B' and ref = 'coin')
    ),

    -- cta.line นับทุกจุดที่ client ส่ง cta=line (ปุ่มหลักหน้าผลลัพธ์ + ทางสำรอง/หน้าช่วยเหลือ) — ฐาน % ที่ถูกจึงไม่ใช่ measured
    'cta', jsonb_build_object(
      'line',     (select count(*) from scoped where cta_line),
      'share',    (select count(*) from scoped where cta_share),
      'shop',     (select count(*) from scoped where cta_shop),
      'gem_quiz', (select count(*) from scoped where cta_gem_quiz)
    ),
    'friction', jsonb_build_object(
      'zoom_blocked',  (select count(*) from scoped where zoom_blocked),
      'calib_warn',    (select count(*) from scoped where calib_warn),
      'invalid',       (select count(*) from scoped where invalid_count > 0),
      'stale_recalib', (select count(*) from scoped where stale_recalib),
      'remeasured',    (select count(*) from scoped where measure_count >= 2)
    ),

    'daily', (
      select jsonb_agg(jsonb_build_object(
               'date', to_char(d.day, 'YYYY-MM-DD'),
               'sessions', coalesce(c.sessions, 0),
               'measured', coalesce(c.measured, 0)
             ) order by d.day)
      from (select gs::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') gs) d
      left join (
        select (sc.created_at at time zone 'Asia/Bangkok')::date as day,
               count(*) as sessions,
               count(*) filter (where sc.result_size is not null) as measured
        from scoped sc
        group by (sc.created_at at time zone 'Asia/Bangkok')::date
      ) c on c.day = d.day
    )
  )
  into v_result;

  return v_result;
end;
$$;

comment on function analytics.ring_size_stats(uuid, date, date) is
  'สถิติ /ring-size สำหรับ /marketing/ring-size — crm_require_owner_admin เป็นด่านแรก (ก่อน validate). '
  'p_from/p_to วันไทย inclusive · p_to - p_from ≤ 180 วัน · ไม่มีตัวกรองช่องทาง (มติ 25 ต.ค. 69). '
  'คืน jsonb ก้อนเดียว ไม่คืนแถวดิบ. invariant: sum(abandon_at)+funnel[7]=sessions. '
  'measured = มี result_size (ไม่ใช่ funnel[7] ซึ่งรวม G4). method{A,B} = วิธีล่าสุด · method_stats = ต่อวิธีจาก used_a/used_b '
  '(นิยามอยู่ในคอมเมนต์ในตัวฟังก์ชัน) · cta.line = ทุกจุดที่ client ส่ง · data_since/shop_range ไม่ขึ้นกับช่วงวัน.';

revoke execute on function analytics.ring_size_stats(uuid, date, date)
  from public, anon, authenticated;
grant execute on function analytics.ring_size_stats(uuid, date, date)
  to service_role;

-- ============================================================================
-- 6. retention 180 วัน (มติเจ้าของ 25 ต.ค. 69 O3 — ทับค่าเสนอ 365) + pg_cron
--    ลบแถวที่ created_at เก่ากว่า 180 วัน · 179 วันยังอยู่ · 181 วันหาย
-- ============================================================================

drop function if exists analytics.ring_size_retention_apply();

create function analytics.ring_size_retention_apply() returns integer
  language plpgsql
  security definer
  set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_deleted integer;
begin
  delete from analytics.ring_size_session
  where created_at < now() - interval '180 days'; -- [mut:retention]
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function analytics.ring_size_retention_apply() is
  'ลบ ring_size_session ที่เก่ากว่า 180 วัน (created_at) คืนจำนวนแถวที่ลบ — เรียกจาก pg_cron job '
  'ring-size-retention-180d ทุกวัน 03:45 (เวลาเซิร์ฟเวอร์ = UTC)';

revoke execute on function analytics.ring_size_retention_apply() from public, anon, authenticated;
grant execute on function analytics.ring_size_retention_apply() to service_role;

-- รูปแบบเดียวกับ 0024/0146: unschedule แล้ว schedule กัน job ซ้อนเมื่อรันไฟล์ซ้ำ
do $cron193$
begin
  perform cron.unschedule('ring-size-retention-180d');
exception when others then
  null; -- job ยังไม่เคยถูกสร้าง
end;
$cron193$;

select cron.schedule(
  'ring-size-retention-180d',
  '45 3 * * *',
  $cronjob$select analytics.ring_size_retention_apply();$cronjob$
);

notify pgrst, 'reload schema';

-- ============================================================================
-- ⚠️ หลัง apply (devops): node scripts/run-sql.mjs scripts/check-analytics-grants.sql
--    + รัน scripts/verify/verify-0193.sql ซ้ำ (do-block + raise บังคับ rollback)
--    ตรวจ overload: select proname, pg_get_function_identity_arguments(oid) from pg_proc
--      where pronamespace='analytics'::regnamespace and proname like 'ring_size%'; — ต้อง 1 แถว/ชื่อ
-- ============================================================================
