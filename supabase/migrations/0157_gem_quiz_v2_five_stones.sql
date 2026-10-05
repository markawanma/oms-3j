-- 0157_gem_quiz_v2_five_stones.sql
-- Gem quiz v2 — reconcile กับแพ็กเกจ UI/UX ภายนอก (5 พลอยแท้ธรรมชาติ แทน 12
-- ตัวเดิม) ตาม design doc:
-- docs/3j-jewelry/analytics/design-gem-quiz-v2-reconcile.md §3.4/§8
-- เจ้าของเคาะคำถามเปิดครบแล้ว 5 ต.ค. 69 (§9: O1/O2/O3/O6)
--
-- ขอบเขตไฟล์นี้ (schema ตารางไม่เปลี่ยนแม้แต่คอลัมน์เดียว):
--   1) ปิด 7 พลอยที่ไม่ใช้แล้วด้วย is_active=false (ไม่ DELETE — ตามที่ comment
--      ของตารางกำหนดไว้ + ย้อนกลับได้ด้วย UPDATE เดียวถ้าเจ้าของเปลี่ยนใจอีก
--      ไม่ใช่เพราะมีประวัติเก่าอ้างอิงอยู่ — V1 ยืนยันแล้วว่า gem_quiz_response
--      มี 0 แถวตอนเขียนไฟล์นี้ ดู design doc §8)
--   2) แก้ label "อเมทิส" → "อเมทิสต์" + sort_order ของ 5 พลอยที่เหลือให้ตรง
--      gemOrder ของแพ็กเกจ (garnet 10, amethyst 20, citrine 30, peridot 40,
--      blue_topaz 50)
--   3) create or replace analytics.gem_quiz_stats — "signature เดิมเป๊ะ"
--      (uuid, date, date, boolean) เพิ่ม 2 ฟิลด์ใน jsonb ที่คืน: liked_first,
--      daily_breakdown — ไม่แตะ gem_quiz_submit บรรทัดใดเลย
--
-- ============================================================================
-- ✅ ซ้อมรันแล้ว (Tech Lead, 5 ต.ค. 69) — ยังไม่ apply จริงบน DB ของ prod
--
-- ก่อน apply ของจริง devops/Tech Lead ยืนยันครบตามนี้แล้ว:
--   1. pg_get_functiondef('analytics.gem_quiz_stats(uuid,date,date,boolean)')
--      สดจาก DB เทียบกับ body ส่วนที่ลอกมาจาก 0154 (ทุกอย่างก่อน liked_first/
--      daily_breakdown) ตรงเป๊ะทุกบรรทัด — ไม่มี migration อื่นแก้ฟังก์ชันนี้
--      หลัง 0154 เลย (0155/0156 แก้แค่ grant ของตาราง)
--   2. pg_trigger ของ gem_quiz_stone/gem_quiz_response ว่างจริง (ไม่มี
--      `create trigger` บน 2 ตารางนี้เลยทั้งรีโป)
--   3. `node scripts/run-sql.mjs` รันไฟล์นี้ต่อกับ scripts/verify-0157.sql
--      ในทรานแซกชันเดียวกัน (ไม่ใส่ --commit — dry-run + rollback อัตโนมัติ
--      เสมอ) ผ่านครบ T1-T10 (10/10) รวม md5(gem_quiz_submit) ก่อน/หลัง
--      เท่ากัน = 4aa13b85a31cd36e3c924f497ce72da4 (ไม่ถูกแตะจริง)
--
-- ⇒ devops: apply ได้เลย (`--commit --record`) แล้วรัน scripts/verify-0157.sql
--   อีกครั้งแบบ real (ไม่ dry-run ก็ได้ เพราะสคริปต์เอง raise exception บังคับ
--   rollback ตัวเองอยู่แล้ว) + scripts/check-analytics-grants.sql +
--   get_advisors(type:"security") เทียบกับก่อน apply ตามลำดับ §10 ข้อ 5 ของ
--   design doc — commit ไฟล์นี้เข้า main ก่อนปิดงานเสมอ (3j-migration-traps #21)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ปิด 7 พลอยที่ไม่ใช้ใน v2 (is_active=false, ไม่ DELETE)
--    idempotent: "and is_active" กันการ UPDATE แถวที่ถูกปิดไปแล้วซ้ำ (ไม่มี
--    trigger บนตารางนี้ตามที่อ่านได้จากทุก migration ในรีโป — ดูคำเตือนด้านบน)
-- ----------------------------------------------------------------------------
update analytics.gem_quiz_stone
   set is_active = false
 where code in ('pearl', 'nil', 'ruby', 'sapphire', 'busarakham', 'iolite', 'kyanite')
   and is_active;

-- ----------------------------------------------------------------------------
-- 2. label + sort_order ของ 5 พลอยที่เหลือ ให้ตรงกับแพ็กเกจ (gemOrder)
--    ทุก UPDATE มี "is distinct from" กันการเขียนทับแถวที่ค่าตรงอยู่แล้ว (รันซ้ำ
--    ได้โดยไม่มีผลข้างเคียง — 3j-migration-traps #19)
-- ----------------------------------------------------------------------------
update analytics.gem_quiz_stone
   set label_th = 'อเมทิสต์'
 where code = 'amethyst'
   and label_th is distinct from 'อเมทิสต์';

update analytics.gem_quiz_stone as s
   set sort_order = v.sort_order
  from (
    values
      ('garnet', 10),
      ('amethyst', 20),
      ('citrine', 30),
      ('peridot', 40),
      ('blue_topaz', 50)
  ) as v(code, sort_order)
 where s.code = v.code
   and s.sort_order is distinct from v.sort_order;

-- ----------------------------------------------------------------------------
-- 3. analytics.gem_quiz_stats — create or replace, signature เดิมเป๊ะ
--    (uuid, date, date, boolean) ⇒ ไม่ชน 3j-migration-traps #1 (overload)
--    body ก่อน liked_first/daily_breakdown ลอกจาก 0154 คำต่อคำ (ดูคำเตือนหัวไฟล์)
-- ----------------------------------------------------------------------------
create or replace function analytics.gem_quiz_stats(
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
    ),
    -- ========================================================================
    -- 🔴 ใหม่ใน v2 (0157) — design doc §3.4/§6
    -- ========================================================================
    -- liked_first: พลอยที่ชอบ "อันดับ 1" (liked_stone_codes[1], 1-indexed ใน
    -- Postgres array) นับแยกจาก 'liked' ซึ่งนับทุกอันดับรวมกัน — ไม่ left join
    -- กับ lookup ตาราง (ไม่เติม 0 ให้พลอยที่ไม่ถูกเลือกเป็นอันดับ 1 เลย ต่างจาก
    -- 'liked'/'recommended' ข้างบนที่โชว์ทุกพลอย active แม้ count=0) — สคีมา
    -- คงที่ {code, count} เท่านั้นตามที่ design doc ระบุ
    'liked_first', (
      select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'count', t.cnt)
               order by t.cnt desc, t.code), '[]'::jsonb)
      from (
        select liked_stone_codes[1] as code, count(*) as cnt
        from scoped
        where cardinality(liked_stone_codes) > 0
        group by liked_stone_codes[1]
      ) t
    ),
    -- daily_breakdown: แตกรายวัน (เวลาไทย, วันที่ลูกค้าทำแบบทดสอบจริง — มติ O6
    -- 5 ต.ค. 69) × ทุกมิติ: ทุก key ที่มีจริงใน answers jsonb ของแถวนั้น (ไม่ fix
    -- รายชื่อ key ไว้ตรงๆ — เผื่อคำถามเปลี่ยนในอนาคตโดยไม่ต้องแก้ migration อีก)
    -- บวก dim สามตัวที่ derive จากคอลัมน์อื่น: liked (ทุกอันดับ), liked_first
    -- (อันดับ 1 เท่านั้น), recommended — group by แล้วนับ ไม่มีแถว count=0 หลุด
    -- ออกมาเพราะไม่ left join กับ lookup ใดๆ (group by ธรรมดาไม่สร้างแถวว่าง)
    'daily_breakdown', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', to_char(t.d, 'YYYY-MM-DD'), 'dim', t.dim, 'code', t.code, 'count', t.cnt
             ) order by t.d, t.dim, t.cnt desc, t.code), '[]'::jsonb)
      from (
        select u.d, u.dim, u.code, count(*) as cnt
        from (
          select (s4.created_at at time zone 'Asia/Bangkok')::date as d,
                 a.key as dim,
                 (a.value #>> '{}') as code
          from scoped s4
          cross join lateral jsonb_each(s4.answers) a
          -- security audit L2 (5 ต.ค. 69): answers เป็น jsonb generic ไม่ผูก
          -- key ตายตัว (ยืนยันจริง: ยิง key "liked" เข้า RPC ตรงๆ DB รับ ไม่
          -- ปฏิเสธ — ด่านเดียวที่กันคือ validate.ts ฝั่ง TS) ถ้าวันหน้ามีทาง
          -- เขียนอื่นที่ไม่ผ่าน validate.ts ชื่อ dim จะชนกับ 3 ชื่อที่ derive
          -- จากคอลัมน์ข้างล่าง กันไว้ตั้งแต่ตอนนี้เพราะยังไม่ apply จริง
          where a.key not in ('liked', 'liked_first', 'recommended')
          union all
          select (s4.created_at at time zone 'Asia/Bangkok')::date as d,
                 'liked' as dim,
                 lk.code as code
          from scoped s4
          cross join lateral unnest(s4.liked_stone_codes) as lk(code)
          union all
          select (s4.created_at at time zone 'Asia/Bangkok')::date as d,
                 'liked_first' as dim,
                 s4.liked_stone_codes[1] as code
          from scoped s4
          where cardinality(s4.liked_stone_codes) > 0
          union all
          select (s4.created_at at time zone 'Asia/Bangkok')::date as d,
                 'recommended' as dim,
                 rc.code as code
          from scoped s4
          cross join lateral unnest(s4.recommended_stone_codes) as rc(code)
        ) u(d, dim, code)
        group by u.d, u.dim, u.code
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
  'table — 3j-migration-traps #12, และ PostgREST ตัดที่ max-rows 1000 เงียบ). '
  'v2 (0157): เพิ่ม liked_first ({code,count} จาก liked_stone_codes[1]) และ '
  'daily_breakdown ([{date,dim,code,count}] แยกรายวันเวลาไทย × ทุก key ใน answers '
  '+ liked/liked_first/recommended) — schema ของสองฟิลด์นี้ design doc ไม่ได้นิยาม '
  'ไว้ตายตัว เป็นการตัดสินใจของ backend-dev (ดูคอมเมนต์ในตัวฟังก์ชัน).';

-- 3j-migration-traps #2: grant ไม่ติดมาเองหลัง create or replace แม้ signature
-- เดิมเป๊ะ — ต้อง revoke/grant ซ้ำทุกครั้งที่แตะฟังก์ชัน (ข้อ 18: ต้องระบุ
-- public, anon, authenticated ทั้งสามชื่อ — ห้าม `to authenticated`)
revoke execute on function analytics.gem_quiz_stats(uuid, date, date, boolean)
  from public, anon, authenticated;
grant execute on function analytics.gem_quiz_stats(uuid, date, date, boolean)
  to service_role;

-- 🔴 ไม่มีบรรทัดไหนในไฟล์นี้แตะ analytics.gem_quiz_submit เลย (ตามที่สั่ง) —
-- ยืนยันก่อน/หลัง apply ด้วย md5(pg_get_functiondef(...)) ต้องเท่ากัน (ดู
-- scripts/verify-0157.sql)

notify pgrst, 'reload schema';

-- ============================================================================
-- ⚠️ หลัง apply ให้รันยืนยัน (ตามลำดับงาน §10 ข้อ 5 ของ design doc — devops):
--   1. node scripts/run-sql.mjs scripts/verify-0157.sql   (dry-run ก่อนเสมอ)
--   2. node scripts/run-sql.mjs scripts/check-analytics-grants.sql
--   3. get_advisors(type: "security") ผ่าน MCP — เทียบกับก่อน apply ต้องไม่มี
--      WARN ใหม่ที่อธิบายไม่ได้
--   4. บันทึกประวัติ migration (supabase_migrations.schema_migrations) +
--      commit ไฟล์นี้เข้า main ก่อนปิดงาน (3j-migration-traps #10/#21)
-- ============================================================================
