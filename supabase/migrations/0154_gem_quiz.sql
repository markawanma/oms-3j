-- 0154_gem_quiz.sql
-- แบบทดสอบเลือกพลอย (gem quiz) — หน้าสาธารณะผ่าน QR บนการ์ดขอบคุณ
-- (design doc: docs/3j-jewelry/analytics/design-gem-quiz.md §3, Tech Lead
-- brief 4 ต.ค. 69 — B1/B4 เคาะแล้ว: Q1 เลือกได้สูงสุด 3 + มี "ยังไม่มีในใจ",
-- ผลแนะนำ 1 พลอยเท่านั้น).
--
-- Additive only: create table/function ใหม่ล้วน ไม่แตะตาราง/ฟังก์ชันเดิมแม้แต่
-- บรรทัดเดียว.
--
-- ============================================================================
-- 🔴 กฎที่สำคัญที่สุดของไฟล์นี้ (design §3.2, §1 F5): analytics.gem_quiz_response
-- ห้ามมีคอลัมน์ IP/IP hash/user-agent/token/cookie id/ข้อความอิสระ/วันเกิดเต็ม
-- เด็ดขาด — ทุกคำตอบเป็นรหัส slug (text/text[]/jsonb ที่ RPC บังคับ whitelist)
-- เท่านั้น ไม่มีช่อง "อื่นๆ (ระบุ)" ที่ไหนในสคีมานี้เลย
--
-- ยืนยันก่อนเขียนไฟล์นี้ (4 ต.ค. 69, ตาม F12 ของ design doc): ค้นทุก migration
-- ที่มีในรีโป (ล่าสุด 0153) ไม่มีใครจอง 0154+ และไม่มีชื่อ gem_quiz_*/quiz/survey
-- ชนในสคีมา analytics — ใช้เลขนี้ได้
--
-- Grant model (3j-migration-traps #18, ยืนยันสดตั้งแต่ 0145/0148/0150/0153):
-- สคีมา analytics ปิด USAGE ให้ anon/authenticated ทั้งสคีมาตั้งแต่ 0123 ⇒ ทุก
-- table/function ใหม่ในไฟล์นี้ grant ให้ service_role อย่างเดียว ไม่มี
-- `to authenticated` ที่ไหนเลย — ตัวอย่างเก่าในสกิล 3j-migration-traps/
-- migration ก่อน 0123 (รวม 0021) ที่เขียน `to authenticated, service_role` คือ
-- ของจริงยุคก่อน ห้ามลอก
-- ============================================================================

-- ============================================================================
-- 1. analytics.gem_quiz_stone — lookup รายชื่อพลอย (pattern เดียวกับ
--    content_type 0145) ไม่ shop-scoped
-- ============================================================================

create table analytics.gem_quiz_stone (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  label_th    text not null,
  -- cross-tab ภายในเท่านั้น (design §3.1) — ห้ามส่งไปหน้าสาธารณะ: ไม่มี RPC
  -- ไหนในไฟล์นี้ที่คืน price_group ให้ caller สาธารณะเลย (gem_quiz_submit คืน
  -- void, gem_quiz_stats ต้องผ่าน crm_require_owner_admin ก่อนเท่านั้น)
  price_group smallint not null check (price_group in (1, 2)),
  sort_order  int not null default 100,
  is_active   boolean not null default true
);

comment on table analytics.gem_quiz_stone is
  'Reference: รายชื่อพลอยสำหรับแบบทดสอบ (gem_quiz_response.liked_stone_codes/'
  'recommended_stone_codes อ้างรหัสจากที่นี่) — price_group ใช้ cross-tab ภายใน '
  'เท่านั้น ห้ามหลุดถึงหน้าสาธารณะ. ปิดพลอยที่เลิกขายด้วย is_active=false (ไม่ลบแถว '
  '— ประวัติเก่ายังอ้างรหัสนี้อยู่).';
comment on column analytics.gem_quiz_stone.price_group is
  'กลุ่มราคาภายใน (1/2) — ใช้ cross-tab ในหน้าสถิติเท่านั้น (design §7.3) ไม่ส่งออก '
  'สู่หน้าสาธารณะที่ไหนเลย.';

alter table analytics.gem_quiz_stone enable row level security;

drop policy if exists read_all on analytics.gem_quiz_stone;
create policy read_all on analytics.gem_quiz_stone
  for select
  using (true);

grant select on analytics.gem_quiz_stone to service_role;

-- seed 12 แถว (design §3.1 — รหัสเสนอ, label ตามที่เจ้าของให้มา; การสะกดคำว่า
-- "บุษราคัม"/"นิล" ยังเป็นคำถามเปิด B2 ของ design doc รอ copywriter ยืนยันคำสุดท้าย
-- — เปลี่ยน label_th ทีหลังได้โดย UPDATE แถว ไม่ต้อง migration ใหม่, do nothing on
-- conflict กัน apply ซ้ำทับ label ที่แก้ไปแล้วเงียบๆ เหมือนแพตเทิร์น 0145)
insert into analytics.gem_quiz_stone (code, label_th, price_group, sort_order) values
  ('blue_topaz',  'บลูโทพาส',  1, 10),
  ('amethyst',    'อเมทิส',    1, 20),
  ('peridot',     'เพอริดอท',  1, 30),
  ('citrine',     'ซิทริน',    1, 40),
  ('garnet',      'โกเมน',     1, 50),
  ('pearl',       'มุก',       2, 60),
  ('nil',         'นิล',       2, 70),
  ('ruby',        'ทับทิม',    2, 80),
  ('sapphire',    'ไพลิน',     2, 90),
  ('busarakham',  'บุษราคัม',  2, 100),
  ('iolite',      'ไอโอไลท์',  2, 110),
  ('kyanite',     'ไคยาไนท์',  2, 120)
on conflict (code) do nothing;

-- ============================================================================
-- 2. analytics.gem_quiz_response — 1 แถว = 1 ครั้งที่ทำเสร็จ (design §3.2)
--
-- 🔴 ไม่มี INSERT grant ให้ใครเลย (ไม่มีแม้แต่ service_role) — ทางเขียนทางเดียว
-- คือผ่าน analytics.gem_quiz_submit (security definer, เจ้าของฟังก์ชัน=postgres
-- ซึ่งเป็นเจ้าของตารางด้วยเลยไม่ถูก RLS/grant บล็อก — pattern เดียวกับที่ 0148
-- L7 ยืนยันไว้สำหรับ content_post). service_role (server action/route handler)
-- ได้แค่ SELECT เท่านั้น ยืนยันด้วย query หลัง apply (ดูคอมเมนต์ท้ายไฟล์นี้).
-- ============================================================================

create table analytics.gem_quiz_response (
  id                      uuid primary key default gen_random_uuid(),
  shop_id                 uuid not null references public.shop (id) on delete cascade,
  created_at              timestamptz not null default now(),
  quiz_version            smallint not null check (quiz_version between 1 and 100),
  src                     text not null check (src in ('card', 'share', 'live', 'direct')),
  liked_stone_codes       text[] not null check (cardinality(liked_stone_codes) <= 3),
  answers                 jsonb not null default '{}'::jsonb
                            check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 512),
  recommended_stone_codes text[] not null check (cardinality(recommended_stone_codes) between 1 and 2),
  is_retake               boolean not null default false
);

comment on table analytics.gem_quiz_response is
  'แบบทดสอบเลือกพลอย — 1 แถว/ครั้งที่ทำเสร็จ. จงใจไม่มีคอลัมน์ IP/IP hash/user-agent/'
  'token/cookie id/ข้อความอิสระ/วันเกิดเต็มเลย (design §3.2, มติเจ้าของ: ไม่เก็บตัวตน '
  'ลูกค้า) — ทุกคำตอบเป็นรหัส slug ที่ analytics.gem_quiz_submit บังคับ whitelist '
  'ก่อน insert เท่านั้น. ไม่มี INSERT grant ให้ role ใดเลย (รวม service_role) — '
  'ทางเขียนทางเดียวคือผ่าน gem_quiz_submit (เจ้าของฟังก์ชัน=เจ้าของตาราง bypass '
  'grant/RLS ได้ตามปกติของ Postgres).';
comment on column analytics.gem_quiz_response.liked_stone_codes is
  'คำตอบ Q1 "ชอบพลอยอะไร" — เลือกได้สูงสุด 3 (B1 เคาะแล้ว 4 ต.ค. 69). {} (array ว่าง) '
  '= เลือกตัวเลือก "ยังไม่มีในใจ".';
comment on column analytics.gem_quiz_response.answers is
  'คำตอบคำถามแนะนำ {question_code: option_code} — เนื้อหาคำถามยังไม่นิ่ง (รอ '
  'copywriter, B3) จึงเก็บแบบ slug-only jsonb ไม่ใช่คอลัมน์เฉพาะต่อคำถาม (design §9). '
  'jsonb_typeof ต้องเป็น object เสมอ (3j-migration-traps #13 — ห้ามเช็คด้วย is not '
  'null กับ jsonb) และห้ามเกิน 512 ไบต์ (กันข้อความอิสระยาวๆ หลุดผ่านแม้ RPC จะ '
  'บังคับ regex ต่อ key/value อีกชั้นแล้วก็ตาม).';
comment on column analytics.gem_quiz_response.recommended_stone_codes is
  'ผลที่ระบบแนะนำ — คำนวณฝั่ง server (lib/gem-quiz/recommend.ts) ไม่เชื่อค่าจาก '
  'client. B4 เคาะแล้ว (4 ต.ค. 69): แนะนำ 1 พลอยเท่านั้น ไม่ใช่ 1 ต่อกลุ่มราคา — '
  'CHECK ยังเผื่อ 1-2 ตามที่ design doc §3.2 ออกแบบไว้แต่ต้น (schema ไม่ต้องเปลี่ยน '
  'ถ้า B4 กลับมติ) แต่ปัจจุบัน route handler ส่งมาแค่ 1 ค่าเสมอ.';

create index idx_gem_quiz_response_shop_created on analytics.gem_quiz_response (shop_id, created_at desc);

alter table analytics.gem_quiz_response enable row level security;

-- SELECT-only policy — defense-in-depth เผื่ออนาคต analytics ถูกเปิด REST อีกครั้ง
-- (วันนี้ GRANT/USAGE ระดับ schema ปิดอยู่แล้วตั้งแต่ 0123, pattern เดียวกับ
-- content_post/content_post_metric ใน 0148).
drop policy if exists tenant_isolation_select on analytics.gem_quiz_response;
create policy tenant_isolation_select on analytics.gem_quiz_response
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

grant select on analytics.gem_quiz_response to service_role;

-- ============================================================================
-- 3. analytics.gem_quiz_submit — RPC สาธารณะ (design §3.3)
--
-- 🔴 ไม่เรียก crm_require_owner_admin โดยตั้งใจ — นี่คือ RPC สาธารณะ (เรียกจาก
-- app/api/gem-quiz/submit/route.ts ด้วย service role หลังผ่านด่าน L1-L3 ของ
-- route handler แล้ว) และฟังก์ชันนั้น short-circuit ให้ service_role ผ่านเสมอ
-- อยู่แล้ว (0021) เรียกไปก็ไม่ได้อะไรเพิ่ม — ด่านสิทธิ์จริงของ RPC ตัวนี้คือ grant
-- (service_role เท่านั้น) ไม่ใช่ owner/admin check
--
-- ด่านทั้ง 7 ข้อตาม design §3.3 — ไม่เชื่อ caller แม้จะมาจาก route handler ที่
-- ตรวจมาแล้วชั้นหนึ่ง (defense-in-depth เดียวกับทุก RPC อื่นในโปรเจกต์นี้)
-- ============================================================================

create function analytics.gem_quiz_submit(
  p_shop_id uuid,
  p_quiz_version smallint,
  p_src text,
  p_liked_stone_codes text[],
  p_answers jsonb,
  p_recommended_stone_codes text[],
  p_is_retake boolean
) returns void
  language plpgsql
  security definer
  set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  -- cap ของ circuit breaker (ข้อ 6 ด้านล่าง) — 100/10 นาที เสนอจาก design §3.3
  -- (ฐาน ~11 ออเดอร์/วัน ⇒ ปกติไม่ถึง 5 ครั้ง/10 นาที) ต้องปรับขึ้นถ้าโปรโมตในไลฟ์
  -- (คำถามเปิด D2 ของ design doc — ยังไม่เคาะ ใช้ค่าเสนอไปก่อน)
  v_cap constant int := 100;
  v_window_count int;
  v_key text;
  v_val jsonb;
  v_answer_key_count int;
begin
  -- 1. ทุกพารามิเตอร์เป็นค่าจำเป็น + quiz_version อยู่ในช่วงที่ตารางยอมรับ
  if p_shop_id is null or p_quiz_version is null or p_src is null
     or p_liked_stone_codes is null or p_answers is null
     or p_recommended_stone_codes is null or p_is_retake is null then
    raise exception 'gem_quiz_submit: ทุกพารามิเตอร์เป็นค่าจำเป็น' using errcode = '22023';
  end if;

  if p_quiz_version < 1 or p_quiz_version > 100 then
    raise exception 'gem_quiz_submit: quiz_version ไม่ถูกต้อง: %', p_quiz_version using errcode = '22023';
  end if;

  -- 2. src whitelist
  if p_src not in ('card', 'share', 'live', 'direct') then
    raise exception 'gem_quiz_submit: src ไม่ถูกต้อง: %', p_src using errcode = '22023';
  end if;

  -- 3. liked_stone_codes: ไม่มี null element, ไม่ซ้ำ, ≤3, ทุกตัวมีจริงและ active
  if array_position(p_liked_stone_codes, null::text) is not null then
    raise exception 'gem_quiz_submit: liked_stone_codes มีค่า null element' using errcode = '22023';
  end if;
  if cardinality(p_liked_stone_codes) > 3 then
    raise exception 'gem_quiz_submit: liked_stone_codes เกิน 3 ตัว' using errcode = '22023';
  end if;
  if cardinality(p_liked_stone_codes) <> (select count(distinct x) from unnest(p_liked_stone_codes) x) then
    raise exception 'gem_quiz_submit: liked_stone_codes มีรหัสซ้ำ' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_liked_stone_codes) as x(code)
    where not exists (select 1 from analytics.gem_quiz_stone s where s.code = x.code and s.is_active)
  ) then
    raise exception 'gem_quiz_submit: liked_stone_codes มีรหัสพลอยที่ไม่มีจริง/ปิดใช้งาน' using errcode = '22023';
  end if;

  -- 4. recommended_stone_codes: ไม่มี null element, 1..2 ตัว, ไม่ซ้ำ, มีจริงใน lookup
  if array_position(p_recommended_stone_codes, null::text) is not null then
    raise exception 'gem_quiz_submit: recommended_stone_codes มีค่า null element' using errcode = '22023';
  end if;
  if cardinality(p_recommended_stone_codes) < 1 or cardinality(p_recommended_stone_codes) > 2 then
    raise exception 'gem_quiz_submit: recommended_stone_codes ต้องมี 1-2 ตัว' using errcode = '22023';
  end if;
  if cardinality(p_recommended_stone_codes) <> (select count(distinct x) from unnest(p_recommended_stone_codes) x) then
    raise exception 'gem_quiz_submit: recommended_stone_codes มีรหัสซ้ำ' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_recommended_stone_codes) as x(code)
    where not exists (select 1 from analytics.gem_quiz_stone s where s.code = x.code)
  ) then
    raise exception 'gem_quiz_submit: recommended_stone_codes มีรหัสพลอยที่ไม่มีจริง' using errcode = '22023';
  end if;

  -- 5. answers shape — 3j-migration-traps #13: ต้องเช็ค jsonb_typeof ห้ามเช็ค
  -- ด้วย "is not null" กับ jsonb (ค่า JSON null ผ่าน is not null ได้เสมอ)
  if jsonb_typeof(p_answers) <> 'object' then
    raise exception 'gem_quiz_submit: answers ต้องเป็น JSON object' using errcode = '22023';
  end if;

  select count(*) into v_answer_key_count from jsonb_object_keys(p_answers);
  if v_answer_key_count > 5 then
    raise exception 'gem_quiz_submit: answers มีมากกว่า 5 คำถาม' using errcode = '22023';
  end if;

  for v_key, v_val in select key, value from jsonb_each(p_answers) loop
    if v_key !~ '^[a-z][a-z0-9_]{0,31}$' then
      raise exception 'gem_quiz_submit: answers มี key ไม่ถูกต้อง: %', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(v_val) <> 'string' then
      raise exception 'gem_quiz_submit: answers.% ต้องเป็น string', v_key using errcode = '22023';
    end if;
    -- ดึงค่า string ดิบจาก jsonb scalar ด้วย #>>'{}' (ไม่ใช่ ::text ซึ่งจะติด
    -- เครื่องหมายคำพูดคู่มาด้วย) ข้อจำกัดที่ยอมรับ (design §3.3 ข้อ 5): เลขล้วน
    -- ยาว ≤32 ตัวผ่าน regex นี้ได้ แต่ route handler ตรวจกับ option whitelist
    -- ของ config เวอร์ชันนั้นก่อนถึง DB อยู่แล้ว
    if (v_val #>> '{}') !~ '^[a-z0-9_]{1,32}$' then
      raise exception 'gem_quiz_submit: answers.% มีค่าไม่ถูกต้อง', v_key using errcode = '22023';
    end if;
  end loop;

  -- 6. circuit breaker — ไม่ lock (ยอมรับ race เกิน cap ได้ไม่กี่แถว, ไม่ใช่เงิน)
  select count(*) into v_window_count
  from analytics.gem_quiz_response
  where shop_id = p_shop_id and created_at > now() - interval '10 minutes';

  if v_window_count >= v_cap then
    raise exception 'gem_quiz_submit: เกินจำนวนที่รับได้ใน 10 นาที (cap=%)', v_cap using errcode = 'P0001';
  end if;

  -- 7. insert แถวเดียว
  insert into analytics.gem_quiz_response (
    shop_id, quiz_version, src, liked_stone_codes, answers, recommended_stone_codes, is_retake
  ) values (
    p_shop_id, p_quiz_version, p_src, p_liked_stone_codes, p_answers, p_recommended_stone_codes, p_is_retake
  );
end;
$$;

comment on function analytics.gem_quiz_submit(uuid, smallint, text, text[], jsonb, text[], boolean) is
  'RPC สาธารณะ (เรียกจาก app/api/gem-quiz/submit/route.ts ด้วย service role เท่านั้น '
  '— ไม่มีด่าน owner/admin โดยตั้งใจ, ดูคอมเมนต์หัวฟังก์ชันในไฟล์ 0154). ตรวจ shape/'
  'whitelist/circuit-breaker ซ้ำทุกข้อแม้ route handler จะตรวจมาแล้วชั้นหนึ่ง '
  '(defense-in-depth). errcode: validation ผิด=22023, เกิน circuit breaker=P0001.';

revoke execute on function analytics.gem_quiz_submit(uuid, smallint, text, text[], jsonb, text[], boolean)
  from public, anon, authenticated;
grant execute on function analytics.gem_quiz_submit(uuid, smallint, text, text[], jsonb, text[], boolean)
  to service_role;

-- ============================================================================
-- 4. analytics.gem_quiz_stats — RPC สำหรับหน้าภายใน (design §3.4)
--
-- returns jsonb (ไม่ใช่ returns table — 3j-migration-traps #12 + PostgREST
-- ตัดที่ max-rows 1000 เงียบ ดังนั้นรวมผลใน DB ครั้งเดียวดีกว่าดึงแถวดิบมารวมใน TS)
-- ============================================================================

create function analytics.gem_quiz_stats(
  p_shop_id uuid,
  p_from date,
  p_to date,
  p_include_retake boolean
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
  if p_shop_id is null or p_from is null or p_to is null or p_include_retake is null then
    raise exception 'gem_quiz_stats: ทุกพารามิเตอร์เป็นค่าจำเป็น' using errcode = '22023';
  end if;

  -- ด่านสิทธิ์ก่อน validate ช่วงวันที่ (กัน probe ด้วยช่วงวันที่ก่อนรู้ว่าไม่มีสิทธิ์)
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_from > p_to then
    raise exception 'gem_quiz_stats: p_from ต้องไม่เกิน p_to' using errcode = '22023';
  end if;
  if (p_to - p_from) > 366 then
    raise exception 'gem_quiz_stats: ช่วงวันที่เกิน 366 วัน' using errcode = '22023';
  end if;

  -- เขตเวลาไทย (3j-migration-traps #6) — p_from/p_to เป็น "วันธุรกิจไทย" แบบ
  -- inclusive ทั้งคู่ ไม่ใช่ current_date (UTC)
  v_from_ts := p_from::timestamp at time zone 'Asia/Bangkok';
  v_to_ts   := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';

  with scoped as (
    select *
    from analytics.gem_quiz_response r
    where r.shop_id = p_shop_id
      and r.created_at >= v_from_ts
      and r.created_at < v_to_ts
      and (p_include_retake or not r.is_retake)
  )
  select jsonb_build_object(
    'respondents', (select count(*) from scoped),
    'by_src', jsonb_build_object(
      'card',   (select count(*) from scoped where src = 'card'),
      'share',  (select count(*) from scoped where src = 'share'),
      'live',   (select count(*) from scoped where src = 'live'),
      'direct', (select count(*) from scoped where src = 'direct')
    ),
    'liked', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'code', s.code, 'label_th', s.label_th, 'price_group', s.price_group,
               'count', coalesce(c.cnt, 0)
             ) order by coalesce(c.cnt, 0) desc, s.sort_order), '[]'::jsonb)
      from analytics.gem_quiz_stone s
      left join (
        select x.code, count(*) as cnt
        from scoped, unnest(liked_stone_codes) as x(code)
        group by x.code
      ) c on c.code = s.code
      where s.is_active
    ),
    'liked_none', (select count(*) from scoped where cardinality(liked_stone_codes) = 0),
    'recommended', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'code', s.code, 'label_th', s.label_th, 'price_group', s.price_group,
               'count', coalesce(c.cnt, 0)
             ) order by coalesce(c.cnt, 0) desc, s.sort_order), '[]'::jsonb)
      from analytics.gem_quiz_stone s
      left join (
        select x.code, count(*) as cnt
        from scoped, unnest(recommended_stone_codes) as x(code)
        group by x.code
      ) c on c.code = s.code
      where s.is_active
    ),
    -- 🔴 ตัดสินใจเองนอก design doc (§3.4 ไม่ได้นิยามสูตรไว้ — เขียนไว้ชัดให้
    -- Tech Lead/security ตรวจทาน): "eligible" = ผู้ตอบที่เลือกพลอยที่ชอบจริง
    -- (liked_stone_codes ไม่ว่าง — ตัดคน "ยังไม่มีในใจ" ออกเพราะไม่มีอะไรให้
    -- เทียบ) "recommended_in_liked" = ในกลุ่ม eligible นั้น มีกี่คนที่พลอยที่
    -- ระบบแนะนำ ตรงกับพลอยที่เขาเลือกไว้เอง (array overlap)
    'agreement', jsonb_build_object(
      'recommended_in_liked', (
        select count(*) from scoped
        where cardinality(liked_stone_codes) > 0
          and recommended_stone_codes && liked_stone_codes
      ),
      'eligible', (select count(*) from scoped where cardinality(liked_stone_codes) > 0)
    ),
    'crosstab', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'question_code', t.question_code, 'option_code', t.option_code,
               'stone_code', t.stone_code, 'count', t.cnt
             )), '[]'::jsonb)
      from (
        select a.key as question_code, (a.value #>> '{}') as option_code, ls.code as stone_code,
               count(*) as cnt
        from scoped s2
        cross join lateral jsonb_each(s2.answers) a
        cross join lateral unnest(s2.liked_stone_codes) as ls(code)
        group by a.key, (a.value #>> '{}'), ls.code
      ) t
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', to_char(t.d, 'YYYY-MM-DD'), 'count', t.cnt
             ) order by t.d), '[]'::jsonb)
      from (
        select (created_at at time zone 'Asia/Bangkok')::date as d, count(*) as cnt
        from scoped
        group by d
      ) t
    ),
    'by_src_liked', (
      select coalesce(jsonb_agg(jsonb_build_object('src', t.src, 'code', t.code, 'count', t.cnt)), '[]'::jsonb)
      from (
        select s2.src as src, ls.code as code, count(*) as cnt
        from scoped s2
        cross join lateral unnest(s2.liked_stone_codes) as ls(code)
        group by s2.src, ls.code
      ) t
    )
  )
  into v_result;

  return v_result;
end;
$$;

comment on function analytics.gem_quiz_stats(uuid, date, date, boolean) is
  'สถิติภายในของ gem quiz สำหรับ /marketing/gem-quiz — เรียก crm_require_owner_admin '
  'เป็นด่านแรก (ก่อน validate ช่วงวันที่ กัน probe). p_from/p_to inclusive ทั้งคู่ '
  'แปลงเป็นเวลาไทยก่อนเทียบกับ created_at. agreement.* เป็นนิยามที่ตัดสินใจเอง '
  'นอก design doc §3.4 — ดูคอมเมนต์ในตัวฟังก์ชัน. คืน jsonb ก้อนเดียว (ไม่ใช่ returns '
  'table — 3j-migration-traps #12, และ PostgREST ตัดที่ max-rows 1000 เงียบ).';

revoke execute on function analytics.gem_quiz_stats(uuid, date, date, boolean)
  from public, anon, authenticated;
grant execute on function analytics.gem_quiz_stats(uuid, date, date, boolean)
  to service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- ⚠️ หลัง apply ให้รันยืนยันด้วยตา (design §3.2 บรรทัดเตือน "implementer"):
--
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'analytics' and table_name = 'gem_quiz_response';
--   -- ต้องเห็นแค่แถวเดียว: service_role / SELECT (ไม่มี INSERT ใครเลย)
--
-- แล้วรัน node scripts/run-sql.mjs scripts/check-analytics-grants.sql ยืนยันว่า
-- ไม่มี grant หลุดไปที่ anon/authenticated/PUBLIC บนฟังก์ชันทั้งสองตัวในไฟล์นี้
-- (ดู scripts/verify-0154.sql สำหรับชุดทดสอบเต็ม — do-block + raise บังคับ
-- rollback เสมอ ตาม 3j-migration-traps #11, ยังไม่ได้รันจริงบน DB ใดๆ ณ ตอนที่
-- เขียนไฟล์นี้ — ดูรายงานส่งมอบ)
-- ============================================================================
