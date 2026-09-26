-- scripts/check-analytics-grants.sql — ด่าน invariant ของสิทธิ์ในสคีมา analytics
--
-- invariant: **ไม่มีฟังก์ชันใดในสคีมา analytics ที่ PUBLIC / anon / authenticated
-- ถือ EXECUTE** และ anon/authenticated ต้องไม่มี USAGE บนสคีมา
--
-- ทำไมต้องมี (บทเรียน 0147, 22 ก.ย. 69): 0123 ปิดสิทธิ์ทั้งสคีมาเมื่อ 16 ก.ย.
-- และได้ผลจริง แต่ migration ที่ลงทีหลัง (0125/0126/0127/0128/0140/0141/0142)
-- grant `to authenticated, service_role` กลับเข้าไปเอง **9 ครั้ง** ภายใน 3 วัน
-- โดยไม่มีใครรู้ตัว เพราะทำตาม boilerplate ที่ skill 3j-migration-traps ข้อ 2
-- เคยสอนไว้ — ไม่มีด่านไหนจับได้เลยจนกระทั่งมีคนไปไล่ ACL ด้วยมือ
-- ⇒ ไฟล์นี้คือด่านนั้น
--
-- 🔴 จงใจ **ไม่ผูกกับรายชื่อฟังก์ชัน** — กวาดทั้งสคีมาด้วย aclexplode ⇒
-- ฟังก์ชันใหม่ที่ยังไม่เกิดก็ถูกคุ้มครองเองอัตโนมัติ ไม่ต้องมาแก้ไฟล์นี้ทุกครั้ง
-- ที่เพิ่ม RPC (หลักเดียวกับ oem-quote-invariants: อย่าผูกกับชื่อตรงๆ)
--
-- วิธีใช้:
--   node scripts/run-sql.mjs scripts/check-analytics-grants.sql
-- รันเมื่อ:
--   1. หลัง apply migration ทุกตัวที่แตะฟังก์ชันในสคีมา analytics
--   2. หลัง rebuild / restore / สร้าง branch DB ใหม่จาก migration ทั้งชุด
--      (🔴 สำคัญที่สุด — replay คือจุดที่ grant เก่าฟื้นกลับมาได้)
--
-- ผลลัพธ์: ผ่าน = raise notice เฉยๆ (ไม่มี error) · ไม่ผ่าน = raise exception
-- พร้อมรายชื่อฟังก์ชัน -> role ที่ถือสิทธิ์อยู่ ⇒ ใช้ใน CI ได้ตรงๆ
-- ไฟล์นี้อ่านอย่างเดียว ไม่เขียนอะไรลง DB เลย (run-sql.mjs rollback อยู่แล้ว
-- โดยค่าตั้งต้น แต่ถึงรันด้วย --commit ก็ไม่มีอะไรให้ commit)

do $chk$
declare
  v_bad_fn    text;
  v_bad_usage text;
begin
  -- 1. execute grant ที่ไม่ควรมี บนฟังก์ชันใดก็ตามในสคีมา
  --    (grantee = 0 คือ PUBLIC — ตัวที่ `revoke ... from anon, authenticated`
  --     ไม่แตะ และเป็นสาเหตุของกลุ่ม "ทาง A" ใน 0147)
  select string_agg(
           format('%s  ->  %s',
                  p.oid::regprocedure,
                  case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end),
           E'\n  ' order by p.proname)
    into v_bad_fn
  from pg_proc p
  cross join lateral aclexplode(p.proacl) a
  where p.pronamespace = 'analytics'::regnamespace
    and a.privilege_type = 'EXECUTE'
    and (a.grantee = 0
         or a.grantee = 'anon'::regrole
         or a.grantee = 'authenticated'::regrole);

  -- 2. USAGE บนตัวสคีมาเอง (กำแพงชั้นนอกที่ 0123 ปิดไว้)
  select string_agg(t.r, ', ' order by t.r)
    into v_bad_usage
  from unnest(array['anon', 'authenticated']) t(r)
  where has_schema_privilege(t.r, 'analytics', 'usage');

  if v_bad_fn is not null or v_bad_usage is not null then
    raise exception E'🔴 ANALYTICS GRANT LEAK\n%',
      concat_ws(E'\n',
        case when v_bad_usage is not null
          then format('- USAGE บนสคีมา analytics หลุดให้: %s  (ควรมีแค่ service_role/postgres)', v_bad_usage) end,
        case when v_bad_fn is not null
          then E'- ฟังก์ชันที่ PUBLIC/anon/authenticated ยังถือ EXECUTE:\n  ' || v_bad_fn end,
        E'\nวิธีแก้: revoke execute on function <sig> from public, anon, authenticated;'
        || E'\n       grant  execute on function <sig> to service_role;'
        || E'\n(ดู supabase/migrations/0147 และ skill 3j-migration-traps ข้อ 18)');
  end if;

  raise notice '✅ analytics: ไม่มีฟังก์ชันไหนเปิดให้ PUBLIC/anon/authenticated และไม่มี USAGE หลุด';
end $chk$;
