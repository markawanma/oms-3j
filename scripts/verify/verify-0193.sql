-- scripts/verify/verify-0193.sql
-- ทดสอบ 0193_ring_size_analytics.sql — do-block + raise exception บังคับ rollback เสมอ
-- (3j-migration-traps #11) ห้ามรันแยกเป็น script ที่ COMMIT · ข้อมูลทดสอบทั้งหมดสร้างผ่าน RPC/fixture
-- ในทรานแซกชันนี้เท่านั้น แล้ว rollback ทิ้ง
--
-- วิธีรัน:
--   ซ้อมก่อน apply (migration + verify รวมไฟล์เดียว — ขึ้นต้น set local lock_timeout = '8s'):
--     cat supabase/migrations/0193_ring_size_analytics.sql scripts/verify/verify-0193.sql > <ไฟล์รวม>
--     node scripts/run-sql.mjs <ไฟล์รวม>            (ห้ามใส่ --commit / --record)
--   หลัง apply จริง: node scripts/run-sql.mjs scripts/verify/verify-0193.sql
--
-- อ่านผล: บรรทัดสรุปท้ายสุดอยู่ในข้อความ error รูปแบบ "ชื่อเทสต์: PASS|FAIL" (ส่วน [live] ที่พิมพ์ระหว่างรัน
-- ใช้ " = " แทน ": " เพื่อไม่ให้นับซ้ำ) · นับ FAIL ด้วย grep -o ': FAIL' (ไม่ grep คำว่า FAIL เฉยๆ)
-- ถ้าทรานแซกชันพังกลางทางด้วย error อื่น = บั๊กของชุดทดสอบ/ของ migration ให้รายงานตามจริง
--
-- ============================================================================
-- ตารางแมป "ข้อในบรีฟ (design §9) → เทสต์ที่ครอบ" (กติกาส่งงาน migration 25 ก.ย. 69)
-- ============================================================================
--  #1  POST ข้าม origin → 403                    : ไม่มีใน SQL — route.test.ts (R1)
--  #2  body > 1 KB → 413                         : ไม่มีใน SQL — route.test.ts (R2)
--  #3  allowlist/ชนิด/NaN/stage 99/sid/src/in_app : T05 (RPC 22023 ~100 รูปแบบ) + T05b (null params)
--                                                  + track-schema.test.ts + route.test.ts (ด่านชั้น route)
--  #4  src นอก lookup → เก็บ direct               : T06
--  #5  sid เดิม 100 ครั้ง → 1 แถว · หยุดที่ 40     : T07 · ค่าที่ลดลงไม่ทับ/ธง OR : T08 · mutant events : M3
--  #6  sid ใหม่ > cap ใน 10 นาที → 429            : T16 · mutant breaker : M4
--  #7  sid ของแถวร้านอื่น → 22023                  : T09 · mutant shop mismatch : M5
--  #8  in_range=true แต่ size=80 → DB ได้ false     : T10 · mutant in_shop_range : M6
--  #9  GET/PUT/DELETE → 405 · path look-alike gate : ไม่มีใน SQL — route.test.ts + exempt-path*.test.ts
--  #10 anon/authenticated เรียก RPC/select → 42501
--      service_role INSERT ตรง → ปฏิเสธ           : T15 · mutant grants : M8
--  #11 stats โดย staff/ไม่ใช่สมาชิก → ปฏิเสธ        : T13 · mutant owner/admin : M7
--      วันผิด/> 366/src นอก lookup → 22023         : T13
--  #12 ไม่มี DEV_SHOP_ID → 500 ไม่ echo            : ไม่มีใน SQL — route.test.ts
--  #13 diff ไม่มี IP/UA/cookie ถูกเก็บ              : T01 (รายชื่อคอลัมน์เป๊ะ 27 ตัว) + route.test.ts (RPC รับเฉพาะ 3 พารามิเตอร์)
--  #14-15,#18-21 (ฝั่ง client/P2)               : ไม่มี — ไม่ใช่งานของ P0/P1
--  #16 หน้ายัง static + header เดิม                : ไม่มีใน SQL — headers.test.ts (ไม่แตะ next.config.mjs) + ผล next build
--  #17 gem-quiz/submit · /w/* · /shop matcher เดิม  : ไม่มีใน SQL — qa-regression.test.ts (differential) + exempt-path.matcher.test.ts
--  UX-A1/A2 used_a/used_b/saw_between + method_stats/switched : T08c (derive + OR + client ส่งตรง) · T12k (ตัวเลข method_stats/switched/saw_between เทียบมือ) · mutant used OR : M10
--  UX-A3/A4 by_src.src+label_th · src_options · shop_range · data_since · cap 180 วัน : T12c/T12l/T12i/T12j · T13e/T13f · mutant cap : M11
--  UX-4     measured = มี result_size (ไม่ใช่ funnel[7]) : T12a/T12d (F5 ถึง stage 7 ด้วย G4 แต่ไม่นับ measured)
--  #22 stats ผลรวมสอดคล้อง · วันไทย 00:00-07:00     : T12 (invariant 5 ข้อ + fixture ข้ามเที่ยงคืนไทย)
--  #23 retention 179 อยู่/181 หาย · cron ไม่ซ้ำ     : T14 · mutant retention : M9
--  #24 grants สะอาด                               : T15 (sweep ทั้งสคีมา) + หลัง apply ต้องรัน scripts/check-analytics-grants.sql
--  ทุกข้อ: ฟังก์ชันที่ถูก replace กลับมาเหมือนเดิม  : T17 (md5 เทียบก่อน/หลัง mutant)
--  ข้อที่ **ไม่มีเทสต์ครอบใน SQL**: #1 #2 #9 #12 #16 #17 (ครอบด้วย vitest ไม่ใช่ที่นี่) · #14-15 #18-21 (P2)
--  ช่องว่างที่ SQL จำลองไม่ได้: race 2 connection พร้อมกันบน sid ใหม่เดียวกัน (ทางแพ้ race ใน upsert:
--    insert ... on conflict do nothing → วนรอบ 2) — do-block ทรานแซกชันเดียวไม่มีสอง connection · ไม่มีเทสต์ครอบ
-- ============================================================================

create temp table _vr (
  n      serial,
  name   text not null,
  ok     boolean not null,
  detail text
) on commit drop;

create temp table _sids (id uuid primary key) on commit drop;

-- บันทึกผล 1 เคส
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default '') returns void
language plpgsql as $f$
begin
  insert into _vr (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  raise notice '[live] % = %', p_name,
    case when coalesce(p_ok, false) then 'PASS' else 'FAIL / ' || coalesce(p_detail, '') end;
end
$f$;

-- เรียก upsert แล้วคืน 'OK' หรือ sqlstate ที่ได้ (ไม่ให้ error ทะลุออกมาพังทั้งบล็อก)
create function pg_temp.up(p_shop uuid, p_sid uuid, p_snap text) returns text
language plpgsql as $f$
begin
  perform analytics.ring_size_session_upsert(p_shop, p_sid, p_snap::jsonb);
  return 'OK';
exception when others then
  return sqlstate;
end
$f$;

-- เรียก stats แล้วคืน 'OK' หรือ sqlstate
create function pg_temp.st(p_shop uuid, p_from date, p_to date, p_src text) returns text
language plpgsql as $f$
begin
  perform analytics.ring_size_stats(p_shop, p_from, p_to, p_src);
  return 'OK';
exception when others then
  return sqlstate;
end
$f$;

-- fixture: สร้าง session ผ่าน RPC แล้วย้าย created_at ไปเวลาที่ต้องการ (เจ้าของตารางทำได้ — ไม่มี trigger ที่ตาราง)
create function pg_temp.fx(p_shop uuid, p_at timestamptz, p_snap text) returns uuid
language plpgsql as $f$
declare
  v_sid uuid := gen_random_uuid();
begin
  perform analytics.ring_size_session_upsert(p_shop, v_sid, p_snap::jsonb);
  update analytics.ring_size_session set created_at = p_at, updated_at = p_at where id = v_sid;
  return v_sid;
end
$f$;

-- ยิง session ใหม่ทีละตัวจนโดนปฏิเสธ (หรือครบ p_n) · คืน 'จำนวนที่สำเร็จ|sqlstate หรือ none' · จด sid ไว้ใน _sids
create function pg_temp.breaker_probe(p_shop uuid, p_n int) returns text
language plpgsql as $f$
declare
  v_i int;
  v_ok int := 0;
  v_sid uuid;
  v_r text;
begin
  for v_i in 1..p_n loop
    v_sid := gen_random_uuid();
    v_r := pg_temp.up(p_shop, v_sid, '{"stage":0}');
    if v_r = 'OK' then
      insert into _sids (id) values (v_sid);
      v_ok := v_ok + 1;
    else
      return v_ok || '|' || v_r;
    end if;
  end loop;
  return v_ok || '|none';
end
$f$;

-- invariant ของ stats (T12): ผลรวมสอดคล้องกันทุกมุม
create function pg_temp.inv(s jsonb) returns boolean
language sql as $f$
select (select coalesce(sum(x::int), 0) from jsonb_array_elements_text(s -> 'abandon_at') x) + (s -> 'funnel' ->> 7)::int = (s ->> 'sessions')::int
   and (s -> 'funnel' ->> 0)::int = (s ->> 'sessions')::int
   and (select coalesce(sum(x.value::int), 0) from jsonb_each_text(s -> 'by_in_app') x) = (s ->> 'sessions')::int
   and (select coalesce(sum((e ->> 'count')::int), 0) from jsonb_array_elements(s -> 'by_src') e) = (s ->> 'sessions')::int
   and (select coalesce(sum((e ->> 'sessions')::int), 0) from jsonb_array_elements(s -> 'daily') e) = (s ->> 'sessions')::int
   and (select bool_and((s -> 'funnel' ->> (k + 1))::int <= (s -> 'funnel' ->> k)::int) from generate_series(0, 6) k)
$f$;

-- สิทธิ์ EXECUTE ที่ไม่ควรมีบนฟังก์ชันใดก็ตามในสคีมา analytics (PUBLIC=grantee 0 · anon · authenticated)
-- logic เดียวกับ scripts/check-analytics-grants.sql ส่วนที่ 1 — ไม่ผูกรายชื่อฟังก์ชัน
create function pg_temp.fn_leaks() returns int
language sql as $f$
select count(*)::int
from pg_proc p
cross join lateral aclexplode(p.proacl) a
where p.pronamespace = 'analytics'::regnamespace
  and a.privilege_type = 'EXECUTE'
  and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole)
$f$;

-- ฟังก์ชัน ring_size_* ที่ proacl เป็น null (= default PUBLIC execute) หรือ service_role ไม่มี EXECUTE
create function pg_temp.fn_missing_service() returns int
language sql as $f$
select count(*)::int
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace
  and p.proname like 'ring\_size\_%'
  and (p.proacl is null
       or not exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 'service_role'::regrole and a.privilege_type = 'EXECUTE'))
$f$;

-- สิทธิ์บนตาราง ring_size_*: grantee ที่ไม่ใช่เจ้าของ และเป็น PUBLIC/anon/authenticated หรือถือสิทธิ์ที่ไม่ใช่ SELECT
create function pg_temp.tbl_leaks() returns int
language sql as $f$
select count(*)::int
from pg_class c
cross join lateral aclexplode(c.relacl) a
where c.oid in ('analytics.ring_size_session'::regclass, 'analytics.ring_size_src'::regclass)
  and a.grantee <> c.relowner
  and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole
       or a.privilege_type <> 'SELECT')
$f$;

do $verify0193$
declare
  v_shop uuid;
  v_other_shop uuid := gen_random_uuid(); -- ไม่มีจริง ใช้ทดสอบ "ร้านอื่น/ไม่พบร้าน"

  -- ชนิดแยกตามความหมาย (3j-migration-traps #16)
  v_sid uuid;
  v_sid2 uuid;
  v_sid3 uuid;
  v_snap text;
  v_state text;
  v_states text;
  v_fails text;
  v_row analytics.ring_size_session%rowtype;
  v_cnt int;
  v_cnt2 int;
  v_baseline int;
  v_text text;
  v_text2 text;
  v_num int;
  v_exp boolean;
  v_def text;
  v_mut text;
  v_stats jsonb;
  v_stats2 jsonb;
  v_probe text;
  v_deleted int;
  v_uid_owner uuid;
  v_uid_staff uuid;
  v_ok boolean;
  v_ok2 boolean;
  v_ok3 boolean;
  v_ok4 boolean;
  v_log text;
  v_pass int;
  v_fail int;

  v_md5_up text;
  v_md5_st text;
  v_md5_rt text;
  v_md5_rg text;
  v_def_up text;
  v_def_st text;
  v_def_rt text;
  v_def_rg text;

  v_expected_cols text[] := array[
    'id', 'shop_id', 'created_at', 'updated_at', 'src', 'in_app', 'is_return', 'max_stage', 'ref', 'method',
    'circ_mm', 'result_size', 'is_between', 'in_shop_range', 'measure_count', 'invalid_count', 'zoom_blocked',
    'calib_warn', 'stale_recalib', 'used_a', 'used_b', 'saw_between', 'cta_line', 'cta_share', 'cta_shop', 'cta_gem_quiz', 'event_count'
  ];
  v_cols text[];
  v_bad_snaps text[];
  v_size int;
  v_sizes int[] := array[44, 45, 52, 68, 69, 80, 30, 90];
begin
  -- crm_require_owner_admin short-circuit เฉพาะ auth.role()='service_role' — connection ผ่าน run-sql.mjs
  -- ไม่มี claim นี้ ต้องตั้งเองในทรานแซกชันนี้ (true = หมดอายุพร้อมทรานแซกชัน, #11)
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select id into v_shop from public.shop order by id limit 1;
  if v_shop is null then
    raise exception 'SETUP FAIL: ไม่พบ public.shop แม้แต่แถวเดียว ทดสอบต่อไม่ได้';
  end if;

  v_def_up := pg_get_functiondef('analytics.ring_size_session_upsert(uuid,uuid,jsonb)'::regprocedure);
  v_def_st := pg_get_functiondef('analytics.ring_size_stats(uuid,date,date,text)'::regprocedure);
  v_def_rt := pg_get_functiondef('analytics.ring_size_retention_apply()'::regprocedure);
  v_def_rg := pg_get_functiondef('analytics.ring_size_shop_range()'::regprocedure);
  v_md5_up := md5(v_def_up);
  v_md5_st := md5(v_def_st);
  v_md5_rt := md5(v_def_rt);
  v_md5_rg := md5(v_def_rg);

  -- --------------------------------------------------------------------
  -- T01 — รายชื่อคอลัมน์เป๊ะ: ไม่มี IP/UA/cookie/device/ข้อความอิสระ/ชื่อ/เบอร์ (design §3.2 · เคส #13)
  -- เพิ่มคอลัมน์ใหม่ = เทสต์นี้ล้ม ต้องมีคนตัดสินใจทบทวนเรื่อง PDPA ก่อน
  -- --------------------------------------------------------------------
  select array_agg(column_name::text order by column_name::text) into v_cols
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'ring_size_session';
  perform pg_temp.chk('T01 (คอลัมน์ ring_size_session ตรงรายการ 27 ตัวเป๊ะ ไม่มี IP/UA/cookie/device/ข้อความอิสระ)',
    v_cols = (select array_agg(x order by x) from unnest(v_expected_cols) x),
    'cols=' || coalesce(v_cols::text, 'null'));

  -- --------------------------------------------------------------------
  -- T02 — signature เดียวต่อชื่อ ไม่เกิด overload ไม่มี default (#1)
  -- --------------------------------------------------------------------
  select count(*), coalesce(sum(pronargdefaults), 0) into v_cnt, v_num
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname like 'ring\_size\_%';
  select count(*) into v_cnt2
  from (select proname from pg_proc where pronamespace = 'analytics'::regnamespace and proname like 'ring\_size\_%'
        group by proname having count(*) > 1) d;
  perform pg_temp.chk('T02 (ฟังก์ชัน ring_size_* มี 4 ตัว ชื่อละ 1 signature ไม่มี default param)',
    v_cnt = 4 and v_num = 0 and v_cnt2 = 0, format('count=%s defaults=%s dup_names=%s', v_cnt, v_num, v_cnt2));

  -- --------------------------------------------------------------------
  -- T03 — seed lookup ช่องทาง 6 รายการ (O2) · ทุกตัว active
  -- --------------------------------------------------------------------
  select string_agg(code, ',' order by sort_order) into v_text from analytics.ring_size_src where is_active;
  select count(*) into v_cnt from analytics.ring_size_src;
  perform pg_temp.chk('T03 (seed ring_size_src = direct,line,fb,web,tiktok,ig · 6 แถว active ทั้งหมด)',
    v_text = 'direct,line,fb,web,tiktok,ig' and v_cnt = 6, format('active=%s total=%s', v_text, v_cnt));

  -- --------------------------------------------------------------------
  -- T04 — happy path: เดินครบ 7 ขั้นของ session เดียว → 1 แถว ค่าตรงทุกช่อง
  -- --------------------------------------------------------------------
  v_sid := gen_random_uuid();
  v_states := '';
  foreach v_snap in array array[
    '{"stage":0,"src":"line","in_app":"line","is_return":false}',
    '{"stage":1}',
    '{"stage":4,"ref":"coin"}',
    '{"stage":5,"method":"A"}',
    '{"stage":6}',
    '{"stage":7,"circ_mm":54.04,"size":52,"between":false,"in_range":true}'
  ] loop
    v_states := v_states || pg_temp.up(v_shop, v_sid, v_snap) || ',';
  end loop;
  select * into v_row from analytics.ring_size_session where id = v_sid;
  select count(*) into v_cnt from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('T04 (เดิน 6 ครั้ง → 1 แถว: stage 7 · src line · ref coin · method A · circ 54.0 · size 52 · in_shop_range true · measure 1 · events 6 · used_a จาก stage 6 + method เดิม)',
    v_states = 'OK,OK,OK,OK,OK,OK,' and v_cnt = 1 and v_row.shop_id = v_shop and v_row.max_stage = 7
      and v_row.src = 'line' and v_row.in_app = 'line' and v_row.is_return = false
      and v_row.ref = 'coin' and v_row.method = 'A' and v_row.circ_mm = 54.0 and v_row.result_size = 52
      and v_row.is_between = false and v_row.in_shop_range = true and v_row.measure_count = 1
      and v_row.invalid_count = 0 and v_row.event_count = 6
      and v_row.used_a = true and v_row.used_b = false and v_row.saw_between = false,
    format('states=%s row=%s', v_states, to_jsonb(v_row)));

  -- --------------------------------------------------------------------
  -- T05 — เคสที่ต้องถูกปฏิเสธ 22023 (design §9 ข้อ 3) · ไม่มีแถวหลุดเข้าตาราง
  -- --------------------------------------------------------------------
  v_bad_snaps := array[
    -- ไม่ใช่ object
    '[]', '"x"', 'null', '123', '[{"stage":1}]', '{}',
    -- stage
    '{"src":"line"}', '{"stage":null}', '{"stage":99}', '{"stage":-1}', '{"stage":8}', '{"stage":1.5}',
    '{"stage":"1"}', '{"stage":1e400}', '{"stage":true}', '{"stage":[1]}',
    -- key นอก allowlist / ชื่อคล้าย / key ที่ client ห้ามกำหนดเอง
    '{"stage":1,"ip":"1.2.3.4"}', '{"stage":1,"user_agent":"x"}', '{"stage":1,"shop_id":"11111111-1111-1111-1111-111111111111"}',
    '{"stage":1,"created_at":"2020-01-01"}', '{"stage":1,"event_count":0}', '{"stage":1,"id":"x"}', '{"stage":1,"max_stage":7}',
    '{"stage":1,"SRC":"line"}', '{"stage":1,"hp":""}', '{"stage":1,"in_shop_range":true}', '{"stage":1,"result_size":50}',
    '{"stage":1,"k1":1,"k2":1,"k3":1,"k4":1,"k5":1,"k6":1,"k7":1,"k8":1,"k9":1,"k10":1,"k11":1,"k12":1,"k13":1,"k14":1,"k15":1,"k16":1,"k17":1,"k18":1,"k19":1,"k20":1}',
    -- circ_mm (NaN/Infinity/ล้น/ผิดชนิด)
    '{"stage":7,"circ_mm":19.9}', '{"stage":7,"circ_mm":120.1}', '{"stage":7,"circ_mm":"NaN"}', '{"stage":7,"circ_mm":1e9}',
    '{"stage":7,"circ_mm":1e400}', '{"stage":7,"circ_mm":"Infinity"}', '{"stage":7,"circ_mm":null}', '{"stage":7,"circ_mm":"54"}',
    '{"stage":7,"circ_mm":-54}', '{"stage":7,"circ_mm":0}',
    -- size
    '{"stage":7,"size":29}', '{"stage":7,"size":91}', '{"stage":7,"size":55.5}', '{"stage":7,"size":"55"}',
    '{"stage":7,"size":1e9}', '{"stage":7,"size":null}', '{"stage":7,"size":0}', '{"stage":7,"size":-1}',
    -- enum
    '{"stage":1,"in_app":"evil"}', '{"stage":1,"in_app":"LINE"}', '{"stage":1,"in_app":7}', '{"stage":1,"in_app":null}',
    '{"stage":1,"ref":"x"}', '{"stage":1,"ref":"Card"}', '{"stage":1,"ref":1}',
    '{"stage":1,"method":"C"}', '{"stage":1,"method":"a"}', '{"stage":1,"method":"AB"}',
    '{"stage":1,"cta":"x"}', '{"stage":1,"cta":"LINE"}', '{"stage":1,"cta":true}', '{"stage":1,"cta":["line"]}',
    -- src รูปแบบผิด (รูปแบบถูกแต่ไม่อยู่ใน lookup ไม่ปฏิเสธ — ดู T06)
    '{"stage":1,"src":"LINE"}', '{"stage":1,"src":"a b"}', '{"stage":1,"src":"abcdefghijklmnopq"}', '{"stage":1,"src":"1abc"}',
    '{"stage":1,"src":5}', '{"stage":1,"src":null}', '{"stage":1,"src":"line;drop"}', '{"stage":1,"src":""}',
    '{"stage":1,"src":"ไทย"}', '{"stage":1,"src":"a-b"}',
    -- boolean ต้องเป็น JSON boolean จริง
    '{"stage":1,"is_return":"true"}', '{"stage":1,"is_return":1}', '{"stage":1,"is_return":null}',
    '{"stage":7,"between":"true"}', '{"stage":7,"between":0}', '{"stage":7,"in_range":1}', '{"stage":7,"in_range":"true"}',
    '{"stage":1,"used_a":"true"}', '{"stage":1,"used_b":1}', '{"stage":1,"used_a":null}', '{"stage":1,"saw_between":null}', '{"stage":1,"saw_between":"x"}',
    '{"stage":1,"g1":"false"}', '{"stage":1,"g3":0}', '{"stage":1,"g4":null}', '{"stage":1,"g5":"x"}'
  ];
  v_fails := '';
  foreach v_snap in array v_bad_snaps loop
    v_sid := gen_random_uuid();
    v_state := pg_temp.up(v_shop, v_sid, v_snap);
    select count(*) into v_cnt from analytics.ring_size_session where id = v_sid;
    if v_state is distinct from '22023' or v_cnt <> 0 then
      v_fails := v_fails || format(' [%s => %s rows=%s]', left(v_snap, 50), v_state, v_cnt);
    end if;
  end loop;
  perform pg_temp.chk(format('T05 (snapshot ผิด %s รูปแบบ ⇒ 22023 ทุกตัว และไม่มีแถวหลุดเข้าตาราง)', cardinality(v_bad_snaps)),
    v_fails = '' and cardinality(v_bad_snaps) >= 80, v_fails);

  -- T05b — พารามิเตอร์ null
  v_sid := gen_random_uuid();
  perform pg_temp.chk('T05b (shop/session/snapshot เป็น SQL NULL ⇒ 22023 ทั้งสามตัว)',
    pg_temp.up(null, v_sid, '{"stage":1}') = '22023'
    and pg_temp.up(v_shop, null, '{"stage":1}') = '22023'
    and pg_temp.up(v_shop, v_sid, null) = '22023'
    and not exists (select 1 from analytics.ring_size_session where id = v_sid));

  -- T05c — ต้องไม่พัง: snapshot ขั้นต่ำสุด และค่าขอบของช่วงที่ถูกต้องต้องผ่าน (เทสต์ฝั่ง "ต้องไม่ถูกปฏิเสธ")
  v_fails := '';
  foreach v_snap in array array[
    '{"stage":0}', '{"stage":7}',
    '{"stage":7,"circ_mm":20,"size":30}', '{"stage":7,"circ_mm":120,"size":90}', '{"stage":7,"circ_mm":54.04,"size":52}',
    '{"stage":1,"is_return":true,"in_app":"unknown","src":"direct"}',
    '{"stage":7,"g4":true,"g1":true,"g3":true,"g5":true,"cta":"gem_quiz"}',
    '{"stage":6,"method":"B","used_a":false,"used_b":true,"saw_between":false}'
  ] loop
    v_state := pg_temp.up(v_shop, gen_random_uuid(), v_snap);
    if v_state <> 'OK' then v_fails := v_fails || format(' [%s => %s]', left(v_snap, 50), v_state); end if;
  end loop;
  perform pg_temp.chk('T05c (ค่าขอบที่ถูกต้อง 20/120/30/90 + ธงครบ ⇒ ต้องผ่าน ไม่ถูกปฏิเสธ)', v_fails = '', v_fails);

  -- --------------------------------------------------------------------
  -- T06 — src: รูปแบบถูกแต่ไม่อยู่ใน lookup/ถูกปิด ⇒ direct (ไม่ปฏิเสธ) · ตั้งครั้งเดียว · in_app เติมได้เฉพาะ unknown
  -- --------------------------------------------------------------------
  v_sid := gen_random_uuid(); v_sid2 := gen_random_uuid(); v_sid3 := gen_random_uuid();
  v_state := pg_temp.up(v_shop, v_sid, '{"stage":0,"src":"zzz"}');
  select src into v_text from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('T06a (src รูปแบบถูกแต่ไม่อยู่ใน lookup ⇒ ไม่ปฏิเสธ เก็บเป็น direct)', v_state = 'OK' and v_text = 'direct', format('%s/%s', v_state, v_text));

  v_state := pg_temp.up(v_shop, v_sid2, '{"stage":0}');
  select src into v_text from analytics.ring_size_session where id = v_sid2;
  perform pg_temp.chk('T06b (ไม่ส่ง src ⇒ direct)', v_state = 'OK' and v_text = 'direct', format('%s/%s', v_state, v_text));

  update analytics.ring_size_src set is_active = false where code = 'ig';
  v_sid3 := gen_random_uuid();
  v_state := pg_temp.up(v_shop, v_sid3, '{"stage":0,"src":"ig"}');
  select src into v_text from analytics.ring_size_session where id = v_sid3;
  update analytics.ring_size_src set is_active = true where code = 'ig';
  v_sid3 := gen_random_uuid();
  v_state := pg_temp.up(v_shop, v_sid3, '{"stage":0,"src":"ig"}');
  select src into v_text2 from analytics.ring_size_session where id = v_sid3;
  perform pg_temp.chk('T06c (src ที่ถูกปิด is_active=false ⇒ direct · เปิดกลับ ⇒ ig)', v_text = 'direct' and v_text2 = 'ig', format('%s/%s', v_text, v_text2));

  v_sid := gen_random_uuid();
  perform pg_temp.up(v_shop, v_sid, '{"stage":0,"src":"line"}');
  v_state := pg_temp.up(v_shop, v_sid, '{"stage":1,"src":"fb"}');
  select src into v_text from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('T06d (src ตั้งครั้งเดียวตอน insert — ส่งใหม่ภายหลังไม่ทับ)', v_state = 'OK' and v_text = 'line', format('%s/%s', v_state, v_text));

  v_sid := gen_random_uuid();
  perform pg_temp.up(v_shop, v_sid, '{"stage":0}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":1,"in_app":"tiktok"}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":2,"in_app":"line"}');
  select in_app into v_text from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('T06e (in_app: unknown เติมได้ครั้งแรก แล้วไม่ถูกทับ)', v_text = 'tiktok', v_text);

  -- --------------------------------------------------------------------
  -- T07 — sid เดิมยิง 100 ครั้ง ⇒ 1 แถว · รับ 40 · ครั้งที่ 41 เป็นต้นไป P0001 · event_count หยุดที่ 40
  -- --------------------------------------------------------------------
  v_sid := gen_random_uuid();
  v_cnt := 0; v_cnt2 := 0; v_text := '';
  for v_num in 1..100 loop
    v_state := pg_temp.up(v_shop, v_sid, '{"stage":1}');
    if v_state = 'OK' then v_cnt := v_cnt + 1;
    elsif v_state = 'P0001' then v_cnt2 := v_cnt2 + 1;
    else v_text := v_text || v_state || ','; end if;
  end loop;
  select * into v_row from analytics.ring_size_session where id = v_sid;
  select count(*) into v_num from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('T07 (sid เดิม 100 ครั้ง ⇒ 1 แถว · สำเร็จ 40 · P0001 60 · event_count หยุดที่ 40 · ไม่มี error อื่น)',
    v_num = 1 and v_cnt = 40 and v_cnt2 = 60 and v_text = '' and v_row.event_count = 40,
    format('rows=%s ok=%s p0001=%s other=%s events=%s', v_num, v_cnt, v_cnt2, v_text, v_row.event_count));

  -- --------------------------------------------------------------------
  -- T08 — monotonic: ค่าที่ลดลงไม่ทับ · ธง OR · ผลวัดทับเป็นก้อน · measure_count/invalid_count
  -- --------------------------------------------------------------------
  v_sid := gen_random_uuid();
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"src":"line","ref":"card","method":"B","circ_mm":54.0,"size":52,"between":true,"cta":"line","g1":true}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":2}');                                -- stage ต่ำกว่า ไม่ทับ
  perform pg_temp.up(v_shop, v_sid, '{"stage":3,"g1":false,"g3":true}');           -- ธงเดิมไม่ถูกปิด · ธงใหม่ติด
  select * into v_row from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('T08a (stage ต่ำกว่าไม่ทับ · ธง g1/cta_line ไม่ถูกปิดด้วยค่า false/ไม่ส่ง · ธงใหม่ติด · ผลวัดเดิมคงอยู่เมื่อไม่ส่งผลใหม่)',
    v_row.max_stage = 7 and v_row.zoom_blocked and v_row.cta_line and v_row.calib_warn
      and v_row.result_size = 52 and v_row.circ_mm = 54.0 and v_row.is_between = true and v_row.measure_count = 1
      and v_row.ref = 'card' and v_row.method = 'B' and v_row.event_count = 3,
    to_jsonb(v_row)::text);

  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":56.5,"size":54}');       -- ผลใหม่ทับทั้งก้อน (between ไม่ส่ง ⇒ null)
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"g4":true}');                      -- G4: ถึง stage 7 ไม่มีเบอร์
  perform pg_temp.up(v_shop, v_sid, '{"stage":5,"ref":"coin","method":"A"}');      -- ref/method ล่าสุดทับ · stage 5 ไม่นับรอบวัด
  select * into v_row from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('T08b (ผลวัดใหม่ทับเป็นก้อน · measure_count นับเฉพาะ stage 7 ที่มีเบอร์ (=2) · G4 นับ invalid 1 และไม่ทับผลเดิม · ref/method ล่าสุดทับ)',
    v_row.circ_mm = 56.5 and v_row.result_size = 54 and v_row.is_between is null and v_row.measure_count = 2
      and v_row.invalid_count = 1 and v_row.ref = 'coin' and v_row.method = 'A' and v_row.max_stage = 7,
    to_jsonb(v_row)::text);

  -- T08c — used_a/used_b/saw_between: derive จาก stage>=6 + method · OR ไม่หลุดเมื่อสลับวิธี · client ส่งตรงได้ · stage<6 ไม่ derive
  v_sid := gen_random_uuid();
  perform pg_temp.up(v_shop, v_sid, '{"stage":6,"method":"B"}');
  select used_a, used_b into v_ok, v_ok2 from analytics.ring_size_session where id = v_sid;
  perform pg_temp.up(v_shop, v_sid, '{"stage":5,"method":"A"}');                   -- เลือกแหวนเดิมแต่ยังไม่เข้าหน้าวัด
  select used_a into v_ok3 from analytics.ring_size_session where id = v_sid;
  perform pg_temp.up(v_shop, v_sid, '{"stage":6}');                                -- เข้าหน้าวัดโดยไม่ส่ง method ⇒ ใช้ method ที่เก็บไว้ (A)
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":54.0,"size":52,"between":true}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":55.0,"size":53}');       -- ผลใหม่ไม่ก้ำกึ่ง: is_between=null แต่ saw_between ยังจำ
  select * into v_row from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('T08c-1 (ลองกระดาษ(B)แล้วเปลี่ยนแหวนเดิม(A): used_b ยังจำ · used_a ติดเมื่อเข้าหน้าวัดเท่านั้น (stage 5 ไม่ติด) · method ล่าสุด=A · saw_between ไม่หลุดเมื่อผลใหม่ไม่ก้ำกึ่ง)',
    v_ok = false and v_ok2 = true and v_ok3 = false and v_row.used_a = true and v_row.used_b = true and v_row.method = 'A'
      and v_row.saw_between = true and v_row.is_between is null,
    format('%s/%s/%s %s', v_ok, v_ok2, v_ok3, to_jsonb(v_row)));

  v_sid := gen_random_uuid(); v_sid2 := gen_random_uuid(); v_sid3 := gen_random_uuid();
  perform pg_temp.up(v_shop, v_sid, '{"stage":2,"used_a":true,"saw_between":true}');
  perform pg_temp.up(v_shop, v_sid2, '{"stage":5,"method":"A"}');
  perform pg_temp.up(v_shop, v_sid3, '{"stage":7,"circ_mm":54,"size":52}');          -- ไม่มี method เลย ⇒ ไม่รู้ว่าวิธีไหน ไม่ derive
  select used_a and saw_between and not used_b into v_ok from analytics.ring_size_session where id = v_sid;
  select not used_a and not used_b into v_ok2 from analytics.ring_size_session where id = v_sid2;
  select not used_a and not used_b and not saw_between into v_ok3 from analytics.ring_size_session where id = v_sid3;
  perform pg_temp.chk('T08c-2 (client ส่ง used_a/saw_between ตรงได้ · stage 5 + method ไม่ derive · stage 7 ไม่มี method ไม่ derive ทั้งสองวิธี)',
    v_ok and v_ok2 and v_ok3, format('%s/%s/%s', v_ok, v_ok2, v_ok3));

  -- --------------------------------------------------------------------
  -- T09 — session ของร้านอื่น ⇒ 22023 และแถวไม่ขยับ · ร้านที่ไม่มีจริง ⇒ ถูกปฏิเสธ (FK)
  -- --------------------------------------------------------------------
  v_sid := gen_random_uuid();
  perform pg_temp.up(v_shop, v_sid, '{"stage":2}');
  v_state := pg_temp.up(v_other_shop, v_sid, '{"stage":7,"circ_mm":54,"size":52}');
  select * into v_row from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('T09a (sid ของแถวร้านอื่น ⇒ 22023 · แถวเดิมไม่ขยับ: stage 2 · events 1 · ไม่มีผลวัด)',
    v_state = '22023' and v_row.shop_id = v_shop and v_row.max_stage = 2 and v_row.event_count = 1 and v_row.result_size is null,
    format('%s %s', v_state, to_jsonb(v_row)));
  v_sid2 := gen_random_uuid();
  v_state := pg_temp.up(v_other_shop, v_sid2, '{"stage":0}');
  perform pg_temp.chk('T09b (sid ใหม่ + ร้านที่ไม่มีจริง ⇒ ถูกปฏิเสธ (FK) ไม่มีแถว)',
    v_state <> 'OK' and not exists (select 1 from analytics.ring_size_session where id = v_sid2), v_state);

  -- --------------------------------------------------------------------
  -- T10 — in_shop_range คำนวณใน DB: ส่ง in_range "โกหก" (ตรงข้ามกับความจริง) ทุกเบอร์ ต้องได้ค่าจริง
  -- --------------------------------------------------------------------
  v_fails := '';
  foreach v_size in array v_sizes loop
    v_exp := v_size between 45 and 68;
    v_sid := gen_random_uuid();
    perform pg_temp.up(v_shop, v_sid, format('{"stage":7,"circ_mm":54,"size":%s,"in_range":%s}', v_size, (not v_exp)::text));
    select in_shop_range into v_ok from analytics.ring_size_session where id = v_sid;
    if v_ok is distinct from v_exp then v_fails := v_fails || format(' [size=%s got=%s want=%s]', v_size, v_ok, v_exp); end if;
  end loop;
  perform pg_temp.chk('T10a (เบอร์ 30/44/45/52/68/69/80/90 + in_range โกหกทุกตัว ⇒ DB ได้ค่าจริง: 45-68 เท่านั้น true)', v_fails = '', v_fails);

  v_sid := gen_random_uuid();
  perform pg_temp.up(v_shop, v_sid, '{"stage":6}');
  select in_shop_range into v_ok from analytics.ring_size_session where id = v_sid;
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":54,"size":50}');
  select in_shop_range into v_ok2 from analytics.ring_size_session where id = v_sid;
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"cta":"line"}');                    -- ไม่ส่งผลใหม่ ⇒ ค่าคงเดิม
  select in_shop_range into v_ok3 from analytics.ring_size_session where id = v_sid;
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":70,"size":80}');          -- ผลใหม่นอกช่วง ⇒ false
  select in_shop_range into v_ok4 from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('T10b (ยังไม่มีเบอร์ ⇒ null · เบอร์ 50 ⇒ true · ไม่ส่งผลใหม่ ⇒ คงเดิม · เบอร์ 80 ⇒ false)',
    v_ok is null and v_ok2 = true and v_ok3 = true and v_ok4 = false, format('%s/%s/%s/%s', v_ok, v_ok2, v_ok3, v_ok4));

  -- --------------------------------------------------------------------
  -- T11 — วัด 3 รอบ → 1 แถว measure_count=3 ค่าล่าสุด · คนกลับมา: is_return ติดแล้วไม่หลุด · stage กระโดด 1→5 ได้
  --       viewLastResult (ไม่ส่ง stage 7) ไม่เพิ่ม measure_count
  -- --------------------------------------------------------------------
  v_sid := gen_random_uuid();
  perform pg_temp.up(v_shop, v_sid, '{"stage":1,"is_return":true}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":5,"method":"A"}');
  select max_stage into v_num from analytics.ring_size_session where id = v_sid;
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":54.0,"size":50}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":55.0,"size":52}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":5}');                                 -- ดูผลเดิม/กลับไปเลือกวิธี ไม่ใช่รอบวัดใหม่
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":56.0,"size":51,"is_return":false}');
  select * into v_row from analytics.ring_size_session where id = v_sid;
  select count(*) into v_cnt from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('T11 (กระโดด 1→5 ได้ · วัด 3 รอบ → 1 แถว measure_count=3 ค่าล่าสุด 56.0/51 · is_return ติดแล้วไม่หลุดด้วย false · stage 5 ไม่นับรอบ)',
    v_num = 5 and v_cnt = 1 and v_row.measure_count = 3 and v_row.circ_mm = 56.0 and v_row.result_size = 51
      and v_row.is_return = true and v_row.event_count = 6,
    format('maxstage_after_jump=%s %s', v_num, to_jsonb(v_row)));

  -- --------------------------------------------------------------------
  -- T12 — stats: shape + ตัวเลขตรงมือคำนวณ + invariant + วันไทย (00:00-07:00 ไม่เหลื่อม · เคส #22)
  -- fixture ใช้ปี 2020 (ก่อนฟีเจอร์นี้มีจริง) ⇒ ไม่ปนข้อมูลจริง · เวลาแต่ละตัวอ้างเขตเวลาไทย (+07)
  --   F1 03-09 23:59:30  F2 03-10 00:30 (UTC ยังเป็น 03-09)  F3 03-10 06:59 (UTC 23:59 ของ 03-09)
  --   F4 03-10 12:00  F5 03-10 23:59:59  F6 03-10 15:00  F8 03-10 10:00  F9 03-10 13:00 (ผสม B→A)  F7 03-11 00:00:00 (UTC 17:00 ของ 03-10)
  -- --------------------------------------------------------------------
  perform pg_temp.fx(v_shop, timestamptz '2020-03-09 23:59:30+07',
    '{"stage":7,"src":"line","in_app":"line","ref":"card","method":"A","circ_mm":50.2,"size":47}');
  v_sid := pg_temp.fx(v_shop, timestamptz '2020-03-10 00:30:00+07',
    '{"stage":7,"src":"line","in_app":"line","is_return":true,"ref":"card","method":"A","circ_mm":54.0,"size":52,"cta":"line"}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":54.0,"size":52,"g5":true}');              -- วัดรอบ 2 → remeasured + stale_recalib
  perform pg_temp.fx(v_shop, timestamptz '2020-03-10 06:59:00+07',
    '{"stage":3,"src":"fb","in_app":"fb","ref":"coin"}');
  perform pg_temp.fx(v_shop, timestamptz '2020-03-10 12:00:00+07',
    '{"stage":7,"src":"direct","in_app":"browser","ref":"coin","method":"B","circ_mm":57.5,"size":40,"between":true,"g3":true,"cta":"share"}');
  perform pg_temp.fx(v_shop, timestamptz '2020-03-10 23:59:59+07',
    '{"stage":7,"src":"line","in_app":"tiktok","ref":"card","method":"B","g4":true,"g1":true}');
  perform pg_temp.fx(v_shop, timestamptz '2020-03-10 15:00:00+07',
    '{"stage":7,"src":"web","in_app":"browser","ref":"card","method":"A","circ_mm":65.0,"size":75,"cta":"shop"}');
  perform pg_temp.fx(v_shop, timestamptz '2020-03-10 10:00:00+07',
    '{"stage":6,"src":"line","in_app":"line","ref":"card","method":"A","cta":"gem_quiz"}');
  -- F9: ลองกระดาษ (B) ถึงหน้าวัด แล้วเปลี่ยนมาแหวนเดิม (A) ได้เบอร์ — ผสมสองวิธีใน session เดียว
  v_sid := pg_temp.fx(v_shop, timestamptz '2020-03-10 13:00:00+07',
    '{"stage":6,"src":"direct","in_app":"browser","ref":"coin","method":"B"}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":5,"method":"A"}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":6}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":52.0,"size":50}');
  perform pg_temp.fx(v_shop, timestamptz '2020-03-11 00:00:00+07',
    '{"stage":0,"src":"direct","in_app":"unknown"}');

  v_stats := analytics.ring_size_stats(v_shop, date '2020-03-10', date '2020-03-10', null);
  perform pg_temp.chk('T12a (วันไทย 03-10 วันเดียว: sessions 7 (ไม่รวม F1 ของ 03-09 และ F7 ของ 03-11 แม้ UTC จะเหลื่อม) · returning 1 · measured 4 (F5 ถึง stage 7 ด้วย G4 แต่ไม่มีเบอร์ ⇒ ไม่นับ))',
    (v_stats ->> 'sessions')::int = 7 and (v_stats ->> 'returning')::int = 1 and (v_stats ->> 'measured')::int = 4,
    v_stats::text);
  perform pg_temp.chk('T12b (funnel=[7,7,7,7,6,6,6,5] · abandon_at=[0,0,0,1,0,0,1] · invariant ผลรวมสอดคล้อง 6 ข้อ)',
    v_stats -> 'funnel' = '[7,7,7,7,6,6,6,5]'::jsonb and v_stats -> 'abandon_at' = '[0,0,0,1,0,0,1]'::jsonb and pg_temp.inv(v_stats),
    v_stats::text);
  select string_agg((e ->> 'src') || '=' || (e ->> 'count'), ',' order by ord) into v_text
  from jsonb_array_elements(v_stats -> 'by_src') with ordinality as t(e, ord);
  perform pg_temp.chk('T12c (by_src (key src + label_th) เรียงตาม sort_order: direct=2,line=3,fb=1,web=1,tiktok=0,ig=0 · by_in_app ตรง)',
    v_text = 'direct=2,line=3,fb=1,web=1,tiktok=0,ig=0'
      and (select bool_and(e ->> 'label_th' is not null) from jsonb_array_elements(v_stats -> 'by_src') e)
      and v_stats -> 'by_in_app' = '{"line":2,"tiktok":1,"fb":1,"ig":0,"browser":3,"unknown":0}'::jsonb,
    v_text || ' ' || (v_stats -> 'by_in_app')::text);
  select string_agg((e ->> 'size') || 'x' || (e ->> 'count'), ',' order by (e ->> 'size')::int) into v_text
  from jsonb_array_elements(v_stats -> 'result_sizes') e;
  select string_agg((e ->> 'mm') || 'x' || (e ->> 'count'), ',' order by (e ->> 'mm')::int) into v_text2
  from jsonb_array_elements(v_stats -> 'circ_hist') e;
  perform pg_temp.chk('T12d (result_sizes 40,50,52,75 อย่างละ 1 · circ_hist 52,54,57,65 อย่างละ 1 (ปัดลงทีละ 1 มม.) · size_summary below/in/above = 1/2/1 · between 1 · invalid 1)',
    v_text = '40x1,50x1,52x1,75x1' and v_text2 = '52x1,54x1,57x1,65x1'
      and v_stats -> 'size_summary' = '{"below_range":1,"in_range":2,"above_range":1,"between_count":1,"invalid_sessions":1}'::jsonb,
    v_text || ' / ' || v_text2 || ' / ' || (v_stats -> 'size_summary')::text);
  perform pg_temp.chk('T12e (method (วิธีล่าสุด) A=4 B=2 · ref card=4 coin=3 · method_x_ref A_card=3 A_coin=1 B_card=1 B_coin=1)',
    v_stats -> 'method' = '{"A":4,"B":2}'::jsonb and v_stats -> 'ref' = '{"card":4,"coin":3}'::jsonb
      and v_stats -> 'method_x_ref' = '{"A_card":3,"A_coin":1,"B_card":1,"B_coin":1}'::jsonb,
    (v_stats -> 'method')::text || (v_stats -> 'ref')::text || (v_stats -> 'method_x_ref')::text);
  perform pg_temp.chk('T12f (cta line/share/shop/gem_quiz = 1/1/1/1 · friction zoom 1 · calib 1 · invalid 1 · stale 1 · remeasured 1)',
    v_stats -> 'cta' = '{"line":1,"share":1,"shop":1,"gem_quiz":1}'::jsonb
      and v_stats -> 'friction' = '{"zoom_blocked":1,"calib_warn":1,"invalid":1,"stale_recalib":1,"remeasured":1}'::jsonb,
    (v_stats -> 'cta')::text || (v_stats -> 'friction')::text);

  perform pg_temp.chk('T12k (method_stats เทียบมือ: A picked 4 measured 3 abandoned 1 invalid 0 remeasured 1 between null · B picked 3 measured 1 abandoned 0 invalid 1 remeasured 0 between 1 · switched a_to_b 0 b_to_a 1 both 1 · saw_between 1 — F9 ที่ลอง B แล้วมา A นับ picked ทั้งสองฝั่ง และอยู่ใน b_to_a)',
    v_stats -> 'method_stats' -> 'A' = '{"picked":4,"measured":3,"abandoned_at_measure":1,"invalid_sessions":0,"remeasured":1,"between":null}'::jsonb
      and v_stats -> 'method_stats' -> 'B' = '{"picked":3,"measured":1,"abandoned_at_measure":0,"invalid_sessions":1,"remeasured":0,"between":1}'::jsonb
      and v_stats -> 'switched' = '{"a_to_b":0,"b_to_a":1,"both":1}'::jsonb
      and (v_stats ->> 'saw_between')::int = 1,
    (v_stats -> 'method_stats')::text || (v_stats -> 'switched')::text);

  select string_agg(e ->> 'code', ',' order by ord) into v_text
  from jsonb_array_elements(v_stats -> 'src_options') with ordinality as t(e, ord);
  perform pg_temp.chk('T12l (src_options = lookup active ทั้งหมดเรียง sort_order แม้ช่องที่ช่วงนี้ไม่มีข้อมูล · shop_range {min:45,max:68} · data_since = วันไทยของแถวแรกสุดของร้าน 2020-03-09 ไม่ขึ้นกับตัวกรอง)',
    v_text = 'direct,line,fb,web,tiktok,ig' and v_stats -> 'shop_range' = '{"min":45,"max":68}'::jsonb
      and v_stats ->> 'data_since' = '2020-03-09',
    v_text || ' ' || (v_stats -> 'shop_range')::text || ' ' || coalesce(v_stats ->> 'data_since', 'null'));

  v_stats2 := analytics.ring_size_stats(v_shop, date '2020-03-09', date '2020-03-11', null);
  select string_agg((e ->> 'date') || ':' || (e ->> 'sessions') || '/' || (e ->> 'measured'), ',' order by e ->> 'date') into v_text
  from jsonb_array_elements(v_stats2 -> 'daily') e;
  perform pg_temp.chk('T12g (ช่วง 03-09..03-11: sessions 9 · daily 03-09:1/1,03-10:7/4,03-11:1/0 — ถ้าใช้วัน UTC จะเหลื่อมและตัวเลขนี้ผิด · invariant ผ่าน)',
    (v_stats2 ->> 'sessions')::int = 9 and v_text = '2020-03-09:1/1,2020-03-10:7/4,2020-03-11:1/0' and pg_temp.inv(v_stats2),
    v_text);

  v_stats2 := analytics.ring_size_stats(v_shop, date '2020-03-10', date '2020-03-10', 'line');
  perform pg_temp.chk('T12h (กรอง src=line วัน 03-10 ⇒ sessions 3 (F2,F5,F8) · invariant ผ่าน)',
    (v_stats2 ->> 'sessions')::int = 3 and pg_temp.inv(v_stats2), v_stats2::text);

  v_stats2 := analytics.ring_size_stats(v_shop, date '2019-01-01', date '2019-01-03', 'ig');
  perform pg_temp.chk('T12i (ต้องไม่พัง: ช่วงว่าง + src ที่มีใน lookup แต่ไม่มีข้อมูล ⇒ sessions 0 · shape ครบ · daily 3 วัน · funnel 8 ช่อง · invariant ผ่าน)',
    (v_stats2 ->> 'sessions')::int = 0 and jsonb_array_length(v_stats2 -> 'daily') = 3
      and jsonb_array_length(v_stats2 -> 'funnel') = 8 and jsonb_array_length(v_stats2 -> 'abandon_at') = 7
      and v_stats2 -> 'result_sizes' = '[]'::jsonb and v_stats2 -> 'circ_hist' = '[]'::jsonb and pg_temp.inv(v_stats2)
      and v_stats2 -> 'method_stats' -> 'A' ->> 'picked' = '0' and v_stats2 -> 'switched' = '{"a_to_b":0,"b_to_a":0,"both":0}'::jsonb
      and jsonb_array_length(v_stats2 -> 'src_options') = 6,
    v_stats2::text);

  v_stats2 := analytics.ring_size_stats(v_other_shop, date '2020-03-10', date '2020-03-10', null);
  perform pg_temp.chk('T12j (แยกร้าน: ร้านอื่นช่วงเดียวกัน ⇒ sessions 0 ไม่เห็นข้อมูลร้านนี้ · data_since เป็น null)',
    (v_stats2 ->> 'sessions')::int = 0 and v_stats2 -> 'data_since' = 'null'::jsonb, v_stats2::text);

  -- --------------------------------------------------------------------
  -- T13 — stats: ด่าน owner/admin + validate (เคส #11)
  -- --------------------------------------------------------------------
  select user_id into v_uid_owner from public.shop_member where shop_id = v_shop and role in ('owner', 'admin') limit 1;
  select user_id into v_uid_staff from public.shop_member where shop_id = v_shop and role not in ('owner', 'admin') limit 1;

  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', gen_random_uuid()), true);
  v_state := pg_temp.st(v_shop, date '2020-03-10', date '2020-03-10', null);
  v_text := pg_temp.st(v_shop, date '2020-03-12', date '2020-03-10', 'zzz');   -- พารามิเตอร์ผิดทุกข้อ แต่ต้องตกที่สิทธิ์ก่อน
  perform pg_temp.chk('T13a (ผู้ใช้ที่ไม่ใช่สมาชิกร้าน ⇒ 42501 · พารามิเตอร์ผิดก็ตกที่สิทธิ์ก่อน 42501 ไม่ใช่ 22023 — กัน probe)',
    v_state = '42501' and v_text = '42501', v_state || '/' || v_text);

  perform set_config('request.jwt.claims', '{}', true);
  v_state := pg_temp.st(v_shop, date '2020-03-10', date '2020-03-10', null);
  perform set_config('request.jwt.claims', '', true);
  v_text := pg_temp.st(v_shop, date '2020-03-10', date '2020-03-10', null);
  perform pg_temp.chk('T13b (ไม่มี claim เลย ({} และสตริงว่าง) ⇒ 42501)', v_state = '42501' and v_text = '42501', v_state || '/' || v_text);

  if v_uid_staff is not null then
    perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_uid_staff), true);
    v_state := pg_temp.st(v_shop, date '2020-03-10', date '2020-03-10', null);
    perform pg_temp.chk('T13c (สมาชิก role staff ของร้าน ⇒ 42501)', v_state = '42501', v_state);
  else
    raise notice '[live] T13c = SKIP (ไม่มีสมาชิก role ที่ไม่ใช่ owner/admin ใน shop_member จริง — ไม่สร้าง fixture เพราะต้องแตะ auth.users)';
    insert into _vr (name, ok, detail) values ('T13c (สมาชิก staff ⇒ 42501) — SKIP ไม่มีสมาชิก staff ให้ทดสอบ', true, 'skip');
  end if;

  if v_uid_owner is not null then
    perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_uid_owner), true);
    v_state := pg_temp.st(v_shop, date '2020-03-10', date '2020-03-10', null);
    perform pg_temp.chk('T13d (ต้องไม่พัง: owner/admin จริงของร้านเรียกได้ ⇒ OK)', v_state = 'OK', v_state);
  else
    insert into _vr (name, ok, detail) values ('T13d (owner/admin จริงเรียกได้) — SKIP ไม่มี owner/admin ใน shop_member', true, 'skip');
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_fails := '';
  -- ทุกเคสนี้ต้อง 22023 เมื่อมีสิทธิ์ (service_role)
  if pg_temp.st(v_shop, date '2020-03-12', date '2020-03-10', null) <> '22023' then v_fails := v_fails || ' [from>to]'; end if;
  if pg_temp.st(v_shop, date '2020-03-10' - 181, date '2020-03-10', null) <> '22023' then v_fails := v_fails || ' [เกิน 180 วัน]'; end if;
  if pg_temp.st(v_shop, date '2019-03-10', date '2020-03-10', null) <> '22023' then v_fails := v_fails || ' [366 วัน — ค่าเก่าก่อนมติ 180]'; end if;
  if pg_temp.st(v_shop, date '2020-03-10', date '2020-03-10', 'zzz') <> '22023' then v_fails := v_fails || ' [src นอก lookup]'; end if;
  if pg_temp.st(v_shop, date '2020-03-10', date '2020-03-10', 'LINE') <> '22023' then v_fails := v_fails || ' [src ตัวพิมพ์ใหญ่]'; end if;
  if pg_temp.st(null, date '2020-03-10', date '2020-03-10', null) <> '22023' then v_fails := v_fails || ' [shop null]'; end if;
  if pg_temp.st(v_shop, null, date '2020-03-10', null) <> '22023' then v_fails := v_fails || ' [from null]'; end if;
  if pg_temp.st(v_shop, date '2020-03-10', null, null) <> '22023' then v_fails := v_fails || ' [to null]'; end if;
  perform pg_temp.chk('T13e (service_role: from>to · เกิน 180 วัน (181 และ 366) · src นอก lookup/ตัวพิมพ์ใหญ่ · พารามิเตอร์ null ⇒ 22023 ทุกตัว)', v_fails = '', v_fails);

  v_ok := pg_temp.st(v_shop, date '2020-03-10' - 180, date '2020-03-10', null) = 'OK'      -- p_to - p_from = 180 พอดี ต้องผ่าน
       and pg_temp.st(v_shop, date '2020-03-10', date '2020-03-10', 'ig') = 'OK'
       and pg_temp.st(v_shop, date '2020-03-10', date '2020-03-10', 'direct') = 'OK';
  perform pg_temp.chk('T13f (ต้องไม่พัง: ช่วง p_to-p_from = 180 พอดี · src ที่อยู่ใน lookup ⇒ OK)', v_ok);

  -- --------------------------------------------------------------------
  -- T14 — retention 180 วัน (179 อยู่ · 181 หาย) + pg_cron ไม่ซ้ำ (เคส #23) · ต้องรันหลัง T12 (fixture ปี 2020 จะถูกลบ)
  -- --------------------------------------------------------------------
  v_sid  := pg_temp.fx(v_shop, now() - interval '179 days', '{"stage":1}');
  v_sid2 := pg_temp.fx(v_shop, now() - interval '181 days', '{"stage":1}');
  v_sid3 := pg_temp.fx(v_shop, now(), '{"stage":1}');
  v_deleted := analytics.ring_size_retention_apply();
  select exists (select 1 from analytics.ring_size_session where id = v_sid),
         exists (select 1 from analytics.ring_size_session where id = v_sid2),
         exists (select 1 from analytics.ring_size_session where id = v_sid3)
    into v_ok, v_ok2, v_ok3;
  v_cnt := analytics.ring_size_retention_apply();
  perform pg_temp.chk('T14a (retention: 179 วันอยู่ · 181 วันหาย · แถวใหม่อยู่ · ลบ >= 1 · รันซ้ำลบ 0)',
    v_ok and not v_ok2 and v_ok3 and v_deleted >= 1 and v_cnt = 0,
    format('179d=%s 181d=%s now=%s deleted=%s second=%s', v_ok, v_ok2, v_ok3, v_deleted, v_cnt));

  select count(*) into v_cnt from cron.job where jobname = 'ring-size-retention-180d';
  select schedule, command into v_text, v_text2 from cron.job where jobname = 'ring-size-retention-180d';
  select count(*) into v_cnt2 from cron.job where jobname like 'ring-size-retention%' and jobname <> 'ring-size-retention-180d';
  perform pg_temp.chk('T14b (cron: job ring-size-retention-180d 1 แถว · 45 3 * * * · เรียก ring_size_retention_apply · ไม่มี job retention ชื่ออื่นค้าง เช่น 365d)',
    v_cnt = 1 and v_text = '45 3 * * *' and v_text2 = 'select analytics.ring_size_retention_apply();' and v_cnt2 = 0,
    format('jobs=%s schedule=%s cmd=%s others=%s', v_cnt, v_text, v_text2, v_cnt2));

  -- apply ซ้ำ (unschedule แล้ว schedule แบบเดียวกับท้าย migration) ต้องไม่ซ้ำ
  begin
    perform cron.unschedule('ring-size-retention-180d');
  exception when others then
    null;
  end;
  perform cron.schedule('ring-size-retention-180d', '45 3 * * *', 'select analytics.ring_size_retention_apply();');
  select count(*) into v_cnt from cron.job where jobname = 'ring-size-retention-180d';
  perform pg_temp.chk('T14c (apply ซ้ำ ⇒ cron job ยังมี 1 แถว ไม่ซ้อน)', v_cnt = 1, 'jobs=' || v_cnt);

  -- --------------------------------------------------------------------
  -- T15 — grants (เคส #10 #24) · ต้องรันก่อน T16 เพราะ T16 ทิ้งแถวจำนวนมาก
  -- --------------------------------------------------------------------
  perform pg_temp.chk('T15a (ACL: ไม่มี PUBLIC/anon/authenticated และไม่มีสิทธิ์อื่นนอกจาก SELECT บนตาราง · service_role ได้ SELECT)',
    pg_temp.tbl_leaks() = 0
      and exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                  where c.oid = 'analytics.ring_size_session'::regclass and a.grantee = 'service_role'::regrole and a.privilege_type = 'SELECT')
      and exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                  where c.oid = 'analytics.ring_size_src'::regclass and a.grantee = 'service_role'::regrole and a.privilege_type = 'SELECT'),
    'tbl_leaks=' || pg_temp.tbl_leaks());
  perform pg_temp.chk('T15b (ACL ฟังก์ชัน: ring_size_* ทั้ง 4 ตัว service_role มี EXECUTE · sweep ทั้งสคีมา analytics ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE)',
    pg_temp.fn_missing_service() = 0 and pg_temp.fn_leaks() = 0,
    format('missing_service=%s leaks=%s', pg_temp.fn_missing_service(), pg_temp.fn_leaks()));
  perform pg_temp.chk('T15c (สคีมา analytics: anon/authenticated ไม่มี USAGE · service_role มี)',
    not has_schema_privilege('anon', 'analytics', 'usage') and not has_schema_privilege('authenticated', 'analytics', 'usage')
      and has_schema_privilege('service_role', 'analytics', 'usage'));

  -- จำลองวันที่กำแพงชั้นนอกหลุด (#18.5): grant usage คืนให้ anon/authenticated แล้วยิงจริงจาก role นั้น ต้องตกที่ 42501
  execute 'grant usage on schema analytics to anon, authenticated';
  v_fails := '';
  foreach v_text in array array['authenticated', 'anon'] loop
    execute format('set local role %I', v_text);
    begin perform analytics.ring_size_session_upsert(v_shop, gen_random_uuid(), '{"stage":0}'::jsonb); v_state := 'OK';
    exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
    if v_state <> '42501' then v_fails := v_fails || format(' [%s upsert=%s]', v_text, v_state); end if;
    begin perform analytics.ring_size_stats(v_shop, date '2020-03-10', date '2020-03-10', null); v_state := 'OK';
    exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
    if v_state <> '42501' then v_fails := v_fails || format(' [%s stats=%s]', v_text, v_state); end if;
    begin perform analytics.ring_size_retention_apply(); v_state := 'OK';
    exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
    if v_state <> '42501' then v_fails := v_fails || format(' [%s retention=%s]', v_text, v_state); end if;
    begin perform analytics.ring_size_shop_range(); v_state := 'OK';
    exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
    if v_state <> '42501' then v_fails := v_fails || format(' [%s shop_range=%s]', v_text, v_state); end if;
    begin perform 1 from analytics.ring_size_session limit 1; v_state := 'OK';
    exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
    if v_state <> '42501' then v_fails := v_fails || format(' [%s select session=%s]', v_text, v_state); end if;
    begin perform 1 from analytics.ring_size_src limit 1; v_state := 'OK';
    exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
    if v_state <> '42501' then v_fails := v_fails || format(' [%s select src=%s]', v_text, v_state); end if;
    execute 'reset role';
  end loop;
  execute 'revoke usage on schema analytics from anon, authenticated';
  perform pg_temp.chk('T15d (กำแพงชั้นนอกหลุด: anon/authenticated เรียก RPC ทั้ง 4 + select ตารางทั้ง 2 จริง ⇒ 42501 ทุกตัว)', v_fails = '', v_fails);

  -- service_role: เขียนตรงเข้าตารางไม่ได้ · อ่านได้ · เรียก RPC ได้ (ต้องไม่พัง)
  execute 'set local role service_role';
  v_fails := '';
  begin insert into analytics.ring_size_session (id, shop_id) values (gen_random_uuid(), v_shop); v_state := 'OK';
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state <> '42501' then v_fails := v_fails || format(' [insert=%s]', v_state); end if;
  begin update analytics.ring_size_session set event_count = 0; v_state := 'OK';
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state <> '42501' then v_fails := v_fails || format(' [update=%s]', v_state); end if;
  begin delete from analytics.ring_size_session; v_state := 'OK';
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state <> '42501' then v_fails := v_fails || format(' [delete=%s]', v_state); end if;
  begin truncate analytics.ring_size_session; v_state := 'OK';
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state <> '42501' then v_fails := v_fails || format(' [truncate=%s]', v_state); end if;
  begin insert into analytics.ring_size_src (code, label_th) values ('evil', 'x'); v_state := 'OK';
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state <> '42501' then v_fails := v_fails || format(' [insert src=%s]', v_state); end if;
  begin perform 1 from analytics.ring_size_session limit 1; v_ok := true;
  exception when others then v_ok := false; end;
  begin perform analytics.ring_size_session_upsert(v_shop, gen_random_uuid(), '{"stage":0}'::jsonb); v_ok2 := true;
  exception when others then v_ok2 := false; end;
  begin perform analytics.ring_size_stats(v_shop, date '2020-03-10', date '2020-03-10', null); v_ok3 := true;
  exception when others then v_ok3 := false; end;
  execute 'reset role';
  perform pg_temp.chk('T15e (service_role: INSERT/UPDATE/DELETE/TRUNCATE ตรงเข้าตาราง และ insert lookup ⇒ 42501 · แต่ SELECT/เรียก upsert/stats ได้ปกติ)',
    v_fails = '' and v_ok and v_ok2 and v_ok3, format('%s select=%s upsert=%s stats=%s', v_fails, v_ok, v_ok2, v_ok3));

  -- --------------------------------------------------------------------
  -- T16 — circuit breaker: แถวใหม่ต่อร้านใน 10 นาที (cap 300) · session เดิมยังส่งต่อได้ · now() คงที่ในทรานแซกชัน (#22)
  --       นับ baseline ก่อน (แถวของเทสต์ก่อนหน้าก็อยู่ในหน้าต่าง) แล้วคาดว่าสำเร็จ = 300 - baseline
  -- --------------------------------------------------------------------
  select count(*) into v_baseline from analytics.ring_size_session where shop_id = v_shop and created_at > now() - interval '10 minutes';
  v_probe := pg_temp.breaker_probe(v_shop, 305);
  select count(*) into v_cnt from analytics.ring_size_session where shop_id = v_shop and created_at > now() - interval '10 minutes';
  perform pg_temp.chk('T16a (cap 300/10 นาที: สำเร็จ = 300 - baseline แล้วโดน P0001 · จำนวนแถวในหน้าต่างหยุดที่ 300)',
    v_probe = greatest(300 - v_baseline, 0) || '|P0001' and v_cnt = greatest(300, v_baseline),
    format('baseline=%s probe=%s window_rows=%s', v_baseline, v_probe, v_cnt));

  select id into v_sid from _sids limit 1;
  if v_sid is not null then
    v_state := pg_temp.up(v_shop, v_sid, '{"stage":2}');
  else
    v_state := 'no-sid';
  end if;
  v_text := pg_temp.up(v_shop, gen_random_uuid(), '{"stage":0}');
  perform pg_temp.chk('T16b (ต้องไม่พัง: ขณะ breaker ทำงาน session ที่มีอยู่แล้วส่งต่อได้ · session ใหม่ยังถูกปฏิเสธ P0001)',
    (v_state = 'OK' or (v_state = 'no-sid' and v_baseline >= 300)) and v_text = 'P0001', format('existing=%s new=%s', v_state, v_text));

  delete from analytics.ring_size_session where id in (select id from _sids);
  delete from _sids;
  select count(*) into v_cnt from analytics.ring_size_session where shop_id = v_shop and created_at > now() - interval '10 minutes';
  perform pg_temp.chk('T16c (เก็บกวาด fixture ของ T16 ด้วย id เจาะจง — จำนวนแถวในหน้าต่างกลับเท่า baseline)', v_cnt = v_baseline, format('after=%s baseline=%s', v_cnt, v_baseline));

  -- ====================================================================
  -- MUTANTS — ตัดด่านทีละตัวชั่วคราว (create or replace ในทรานแซกชันนี้) แล้วยิง "ตัวตรวจ" เดิม
  -- ผ่าน = เทสต์ตัวนั้นจับ mutant ได้จริง (ผลของ mutant ต่างจากของจริง) · ทุกตัว restore ท้ายเคส + T17 เทียบ md5
  -- ====================================================================

  -- M1 allowlist
  v_mut := replace(v_def_up, 'if not (v_key = any (v_allowed)) then', 'if false then');
  if v_mut = v_def_up then
    perform pg_temp.chk('M1 (mutant: ตัด allowlist ⇒ T05 ต้องล้ม)', false, 'needle ไม่เจอในฟังก์ชัน — marker เปลี่ยนไปแต่ verify ไม่ตามแก้');
  else
    execute v_mut;
    v_sid := gen_random_uuid();
    v_state := pg_temp.up(v_shop, v_sid, '{"stage":1,"ip":"1.2.3.4"}');
    execute v_def_up;
    perform pg_temp.chk('M1 (mutant: ตัด allowlist ⇒ key ip หลุดผ่าน ไม่ใช่ 22023 = T05 จับได้)', v_state <> '22023', 'mutant ให้ผล ' || v_state);
  end if;

  -- M2 monotonic
  v_mut := replace(v_def_up, 'greatest(s.max_stage, v_stage)', 'v_stage');
  if v_mut = v_def_up then
    perform pg_temp.chk('M2 (mutant: stage ไม่ monotonic ⇒ T07/T08 ต้องล้ม)', false, 'needle ไม่เจอ');
  else
    execute v_mut;
    v_sid := gen_random_uuid();
    perform pg_temp.up(v_shop, v_sid, '{"stage":7}');
    perform pg_temp.up(v_shop, v_sid, '{"stage":2}');
    select max_stage into v_num from analytics.ring_size_session where id = v_sid;
    execute v_def_up;
    perform pg_temp.chk('M2 (mutant: max_stage ใช้ค่าล่าสุดแทน greatest ⇒ ได้ 2 ไม่ใช่ 7 = T08a จับได้)', v_num = 2, 'mutant ได้ max_stage=' || v_num);
  end if;

  -- M3 event_count
  v_mut := replace(v_def_up, 'if v_old.event_count >= v_max_events then', 'if false then');
  if v_mut = v_def_up then
    perform pg_temp.chk('M3 (mutant: ตัดเพดาน event_count ⇒ T07 ต้องล้ม)', false, 'needle ไม่เจอ');
  else
    execute v_mut;
    v_sid := gen_random_uuid();
    v_state := 'OK';
    for v_num in 1..41 loop
      v_state := pg_temp.up(v_shop, v_sid, '{"stage":1}');
    end loop;
    execute v_def_up;
    perform pg_temp.chk('M3 (mutant: ตัดเพดาน 40 ⇒ ครั้งที่ 41 ไม่ใช่ P0001 (ไปชน CHECK 23514 แทน) = T07 จับได้)', v_state is distinct from 'P0001', 'mutant ให้ผล ' || v_state);
  end if;

  -- M4 circuit breaker
  select count(*) into v_baseline from analytics.ring_size_session where shop_id = v_shop and created_at > now() - interval '10 minutes';
  v_mut := replace(v_def_up, 'if v_window_count >= v_cap then', 'if false then');
  if v_mut = v_def_up then
    perform pg_temp.chk('M4 (mutant: ตัด circuit breaker ⇒ T16 ต้องล้ม)', false, 'needle ไม่เจอ');
  else
    execute v_mut;
    v_probe := pg_temp.breaker_probe(v_shop, 305);
    execute v_def_up;
    delete from analytics.ring_size_session where id in (select id from _sids);
    delete from _sids;
    perform pg_temp.chk('M4 (mutant: ตัด breaker ⇒ ยิง 305 ตัวผ่านหมด ไม่โดน P0001 = T16a จับได้)', v_probe = '305|none', 'mutant ให้ผล ' || v_probe);
  end if;

  -- M5 shop mismatch
  v_mut := replace(v_def_up, 'if v_old.shop_id <> p_shop_id then', 'if false then');
  if v_mut = v_def_up then
    perform pg_temp.chk('M5 (mutant: ตัดด่าน shop mismatch ⇒ T09 ต้องล้ม)', false, 'needle ไม่เจอ');
  else
    v_sid := gen_random_uuid();
    perform pg_temp.up(v_shop, v_sid, '{"stage":2}');
    execute v_mut;
    v_state := pg_temp.up(v_other_shop, v_sid, '{"stage":7,"circ_mm":54,"size":52}');
    execute v_def_up;
    perform pg_temp.chk('M5 (mutant: ตัด shop mismatch ⇒ ร้านอื่นแก้แถวได้ (OK) ไม่ใช่ 22023 = T09a จับได้)', v_state = 'OK', 'mutant ให้ผล ' || v_state);
  end if;

  -- M6 in_shop_range คำนวณใน DB — mutant: ช่วงกว้างเกินจริง (ผลเหมือนเชื่อ in_range ของ client ที่โกหกว่า true)
  v_mut := replace(v_def_rg, 'int4range(45, 68, ''[]'')', 'int4range(0, 200, ''[]'')');
  if v_mut = v_def_rg then
    perform pg_temp.chk('M6 (mutant: ช่วงเบอร์ร้านผิด ⇒ T10 ต้องล้ม)', false, 'needle ไม่เจอ');
  else
    execute v_mut;
    v_sid := gen_random_uuid();
    perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":70,"size":80,"in_range":false}');
    select in_shop_range into v_ok from analytics.ring_size_session where id = v_sid;
    execute v_def_rg;
    perform pg_temp.chk('M6 (mutant: ช่วงร้านกว้าง 0-200 ⇒ เบอร์ 80 ได้ in_shop_range=true = T10a จับได้)', v_ok = true, 'mutant ได้ ' || coalesce(v_ok::text, 'null'));
  end if;

  -- M7 stats owner/admin
  v_mut := replace(v_def_st, 'perform analytics.crm_require_owner_admin(p_shop_id);', 'null;');
  if v_mut = v_def_st then
    perform pg_temp.chk('M7 (mutant: ตัดด่าน owner/admin ⇒ T13 ต้องล้ม)', false, 'needle ไม่เจอ');
  else
    execute v_mut;
    perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', gen_random_uuid()), true);
    v_state := pg_temp.st(v_shop, date '2020-03-10', date '2020-03-10', null);
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute v_def_st;
    perform pg_temp.chk('M7 (mutant: ตัดด่านสิทธิ์ ⇒ คนนอกร้านอ่านสถิติได้ (OK) ไม่ใช่ 42501 = T13a จับได้)', v_state = 'OK', 'mutant ให้ผล ' || v_state);
  end if;

  -- M8 grants: จำลองสิทธิ์รั่ว 3 แบบ ตัวตรวจ T15 ต้องรายงานรั่วทุกแบบ แล้วกลับเป็นสะอาดหลัง revoke
  execute 'grant execute on function analytics.ring_size_session_upsert(uuid, uuid, jsonb) to anon';
  v_cnt := pg_temp.fn_leaks();
  execute 'revoke execute on function analytics.ring_size_session_upsert(uuid, uuid, jsonb) from public, anon, authenticated';
  execute 'grant execute on function analytics.ring_size_stats(uuid, date, date, text) to public';
  v_cnt2 := pg_temp.fn_leaks();
  execute 'revoke execute on function analytics.ring_size_stats(uuid, date, date, text) from public, anon, authenticated';
  execute 'grant insert on analytics.ring_size_session to service_role';
  v_num := pg_temp.tbl_leaks();
  execute 'revoke insert on analytics.ring_size_session from service_role';
  perform pg_temp.chk('M8 (mutant: grant execute ให้ anon / PUBLIC และ grant insert ให้ service_role ⇒ ตัวตรวจ T15 รายงานรั่วทุกแบบ แล้วสะอาดหลัง revoke)',
    v_cnt >= 1 and v_cnt2 >= 1 and v_num >= 1 and pg_temp.fn_leaks() = 0 and pg_temp.tbl_leaks() = 0,
    format('anon=%s public=%s tbl_insert=%s after_leaks=%s/%s', v_cnt, v_cnt2, v_num, pg_temp.fn_leaks(), pg_temp.tbl_leaks()));

  -- M10 used_a/used_b OR monotonic
  v_mut := replace(v_def_up, 's.used_a or coalesce(v_used_a, false)', 'coalesce(v_used_a, false)');
  if v_mut = v_def_up then
    perform pg_temp.chk('M10 (mutant: used_a ไม่ OR ⇒ T08c ต้องล้ม)', false, 'needle ไม่เจอ');
  else
    execute v_mut;
    v_sid := gen_random_uuid();
    perform pg_temp.up(v_shop, v_sid, '{"stage":6,"method":"A"}');
    perform pg_temp.up(v_shop, v_sid, '{"stage":6,"method":"B"}');
    select used_a into v_ok from analytics.ring_size_session where id = v_sid;
    execute v_def_up;
    perform pg_temp.chk('M10 (mutant: used_a ไม่ OR ⇒ สลับ A→B แล้ว used_a หาย (false) = T08c จับได้)', v_ok = false, 'mutant ได้ used_a=' || coalesce(v_ok::text, 'null'));
  end if;

  -- M11 เพดานช่วงวัน 180
  v_mut := replace(v_def_st, 'if (p_to - p_from) > 180 then', 'if (p_to - p_from) > 366 then');
  if v_mut = v_def_st then
    perform pg_temp.chk('M11 (mutant: เพดานช่วงวันกลับเป็น 366 ⇒ T13e ต้องล้ม)', false, 'needle ไม่เจอ');
  else
    execute v_mut;
    v_state := pg_temp.st(v_shop, date '2020-03-10' - 181, date '2020-03-10', null);
    execute v_def_st;
    perform pg_temp.chk('M11 (mutant: เพดาน 366 ⇒ ช่วง 181 วันผ่าน (OK) ไม่ใช่ 22023 = T13e จับได้)', v_state = 'OK', 'mutant ให้ผล ' || v_state);
  end if;

  -- M9 retention
  v_mut := replace(v_def_rt, 'interval ''180 days''', 'interval ''365 days''');
  if v_mut = v_def_rt then
    perform pg_temp.chk('M9 (mutant: retention 365 วัน ⇒ T14a ต้องล้ม)', false, 'needle ไม่เจอ');
  else
    v_sid2 := pg_temp.fx(v_shop, now() - interval '181 days', '{"stage":1}');
    execute v_mut;
    perform analytics.ring_size_retention_apply();
    select exists (select 1 from analytics.ring_size_session where id = v_sid2) into v_ok;
    execute v_def_rt;
    delete from analytics.ring_size_session where id = v_sid2;
    perform pg_temp.chk('M9 (mutant: retention 365 วัน ⇒ แถวอายุ 181 วันยังอยู่ = T14a จับได้)', v_ok, 'mutant: 181d รอด=' || v_ok);
  end if;

  -- --------------------------------------------------------------------
  -- T17 — ฟังก์ชันทุกตัวกลับมาเหมือนเดิมหลัง mutant (md5 ของ pg_get_functiondef) + ACL ยังสะอาด + signature ไม่เพิ่ม
  -- --------------------------------------------------------------------
  perform pg_temp.chk('T17a (restore: md5 ของ upsert/stats/retention/shop_range เท่าก่อนทำ mutant ทุกตัว)',
    md5(pg_get_functiondef('analytics.ring_size_session_upsert(uuid,uuid,jsonb)'::regprocedure)) = v_md5_up
    and md5(pg_get_functiondef('analytics.ring_size_stats(uuid,date,date,text)'::regprocedure)) = v_md5_st
    and md5(pg_get_functiondef('analytics.ring_size_retention_apply()'::regprocedure)) = v_md5_rt
    and md5(pg_get_functiondef('analytics.ring_size_shop_range()'::regprocedure)) = v_md5_rg);
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace and proname like 'ring\_size\_%';
  perform pg_temp.chk('T17b (หลัง mutant: signature ยัง 4 ตัว · ACL ยังสะอาด — create or replace ไม่ทำ grant หาย/หลุด)',
    v_cnt = 4 and pg_temp.fn_missing_service() = 0 and pg_temp.fn_leaks() = 0 and pg_temp.tbl_leaks() = 0,
    format('sigs=%s missing_service=%s leaks=%s/%s', v_cnt, pg_temp.fn_missing_service(), pg_temp.fn_leaks(), pg_temp.tbl_leaks()));

  -- --------------------------------------------------------------------
  -- Z1 — อ่านอย่างเดียวกับข้อมูลจริงของร้าน (ไม่พิมพ์ค่าออก): stats 30 วันล่าสุดต้องไม่ error และ invariant ผ่าน
  -- --------------------------------------------------------------------
  v_stats := analytics.ring_size_stats(v_shop, (now() at time zone 'Asia/Bangkok')::date - 29, (now() at time zone 'Asia/Bangkok')::date, null);
  perform pg_temp.chk('Z1 (stats 30 วันล่าสุดบนข้อมูลจริง: ไม่ error · invariant ผ่าน · daily 30 วัน)',
    jsonb_typeof(v_stats) = 'object' and pg_temp.inv(v_stats) and jsonb_array_length(v_stats -> 'daily') = 30);

  -- --------------------------------------------------------------------
  select count(*) filter (where ok), count(*) filter (where not ok) into v_pass, v_fail from _vr;
  select string_agg(format('%s: %s%s', name, case when ok then 'PASS' else 'FAIL' end,
                           case when ok then '' else ' — ' || coalesce(detail, '') end), E'\n' order by n)
    into v_log from _vr;
  raise exception E'\n=== verify-0193 (ring_size_analytics) ===\n%\n--- PASS=% FAIL=% (ทั้งก้อน rollback แล้ว — DB ไม่ขยับ) ---', v_log, v_pass, v_fail;
end;
$verify0193$;
