-- scripts/verify/verify-0196.sql
-- ทดสอบ 0196_ring_builder.sql — do-block + raise exception บังคับ rollback เสมอ (3j-migration-traps #11)
-- ข้อมูลทดสอบทั้งหมดสร้างผ่าน RPC ของระบบเท่านั้น (ห้าม insert/update/delete ตารางตรง ยกเว้นเคสที่ตั้งใจพิสูจน์ว่า "trigger/CHECK ตอบโต้การเขียนตรง" — ทำใน tx ที่ rollback)
--
-- วิธีรัน (Part 0 = ลง DDL ในทรานแซกชันเดียวกัน: migration + verify ต่อเป็นไฟล์เดียว — ขึ้นต้น set local lock_timeout = '8s' ของ migration)
--   cat supabase/migrations/0196_ring_builder.sql scripts/verify/verify-0196.sql > <ไฟล์รวม ใน scratchpad>
--   cd <checkout หลัก> && node scripts/run-sql.mjs <ไฟล์รวม>            (🔴 ห้าม --commit / --record · ห้ามรันช่วง 20:00-23:00 ไทย)
-- หลัง apply จริง: node scripts/run-sql.mjs scripts/verify/verify-0196.sql (Part 0 ข้ามเมื่อมีตารางแล้ว)
--
-- อ่านผล: บรรทัดสรุปท้ายสุดอยู่ในข้อความ error รูปแบบ "ชื่อเทสต์: PASS|SKIP|FAIL" · นับ FAIL ด้วย grep -o ': FAIL' และ SKIP ด้วย grep -o ': SKIP'
--   ตัวช่วยพิมพ์ระหว่างรันใช้ " = " แทน ": " เพื่อไม่ให้นับซ้ำ · ท้ายสุด "PASS=n SKIP=n FAIL=n" · SKIP (ok = null) = ไม่มีข้อมูลให้ทดสอบ ห้ามอ่านเป็นผ่าน
--   ตัวเลขเงินในไฟล์นี้เป็นตัวอย่าง (480/500/80/120/150) ไม่ใช่ราคาจริงของร้าน
--
-- ============================================================================
-- ตารางแมป "ข้อในบรีฟ (design §8 X1–X8 · §16 X9–X20 · §9 + §16 ต้องไม่พัง) → เทสต์ที่ครอบ"
-- ============================================================================
--  X1  ต้นทุนหลุดถึง bundle/payload
--        สิทธิ์ service_role บน analytics.gem_item_price = ไม่มี (ตรวจสด)      : T02a
--        INVOKER พิสูจน์พฤติกรรม: ฟังก์ชัน INVOKER ที่ join ตารางต้นทุน → 42501 : T02b
--        rb_public_catalog/rb_quote ไม่ใช่ definer · ไม่อ้าง gem_item_price       : T02c
--        ตาราง rb_* ไม่มีคอลัมน์ชื่อต้นทุน/margin/รับซื้อ                           : T03a
--        key ของ jsonb สาธารณะ = allowlist เป๊ะ (catalog/design/offer/stone/quote) : T03b-T03e
--        ส่วน TS (mapper ทีละ field · boundary · key ของ PublicCatalog/response) : ไม่มีใน SQL — lib/ring-builder/*.test.ts
--  X2  รหัสปลอม/แก้บิต                       : ไม่มีใน SQL — code.test.ts + code-sign.test.ts (HMAC/check char อยู่ฝั่ง TS ทั้งหมด)
--        rb_code_check รับเฉพาะรหัสที่ TS ยืนยันแล้ว: actor ปลอม/ไม่ใช่ owner-admin → T19
--  X3  พลอยปิด/ไม่มีราคา/ขนาดอื่นถูกเลือก    : T04 (ขนาดอื่น · offer ไม่มีราคา · ทรงอื่น) + T05 (ปิดหลังโหลดหน้า)
--  X4  จำนวนเม็ดไม่ตรง                       : T06 (n=2/6/8 · invalid) + T13 (ล็อก stone_count หลัง publish) · decoder ฝั่ง TS = code.test.ts
--  X5  ไซซ์นอก 45–68/นอกช่วงของแบบ           : T07 · T15 · (45.5/NaN/string ฝั่ง route schema = route.test.ts)
--  X6  ราคาเปลี่ยนหลังออกรหัส                : T08 (ตรวจย้อนได้ทั้งสองราคา · UPDATE/DELETE/TRUNCATE ราคา = ล้ม) · 409 handshake ฝั่ง route = route.test.ts
--  X7  ช่องเขียนสาธารณะ                      : T09 (service_role เขียนตรงไม่ได้ · RPC สาธารณะไม่เขียน) · ด่าน route 403/413/400 = route.test.ts
--  X8  Server Action หลุดผ่าน exempt path     : ไม่มีใน SQL — boundary.test.ts + exempt-path*.test.ts
--  X9  ทรงปิดแต่แบบ/offer ยังเปิด            : T10
--  X10 ขนาด offer ไม่ตรงแบบ (205 vs 200 · 3×3 vs 2×2) : T04
--  X11 ขนาดตรงแต่ทรงต่าง                     : T04 (ไข่ 4×3 vs หยด 4×3)
--  X12 round ที่ major≠minor · oval ที่ = / < : T11
--  X13 offer ซ้ำ (สลับ 3×4/4×3 · แถวที่ปิด)    : T12
--  X14 แก้ stone_count/ทรง/ขนาด/ทิศ หลัง publish (RPC + UPDATE ตรง) · แก้ render_kind : T13
--  X15 แบบที่เปิดอยู่ชื่อซ้ำ                 : T14
--  X16 size_idx 24..30                        : ไม่มีใน SQL — code.test.ts · size นอกช่วงของแบบ = T07/T15
--  X17 check char                             : ไม่มีใน SQL — code.test.ts
--  X18 mm (2,5 / 2.555 / NaN / 0 / 25 / ว่าง)  : parser = mm.test.ts · CHECK/RPC ฝั่ง DB (49/2001/null/ราคานอกช่วง) = T16
--  X19 GLB                                    : ไม่มี — P2 ยังไม่ทำ (validator/ไฟล์) · ส่วนที่ครอบ: แก้ stone_count ขณะมี model = ปฏิเสธ + model ต้องเป็น object : T17
--  X20 ร่าง/พรีวิวหลุดถึงสาธารณะ              : T18 (ร่าง/ปิดแล้ว/ร้านอื่นไม่โผล่ใน catalog+quote) · allowlist = T03
--  ต้องไม่พัง (§9 + §16):
--    พลอยชนิดเดียวมีราคากลมและไข่ → ขึ้นทั้งสองด้วยราคาของทรงนั้น                 : T04
--    แบบที่ไม่มีรูปการ์ด/ไม่มีพลอยสีเลย (CZ ล้วน) ยังออกราคาได้                   : T04 (D4) · T18
--    รหัสที่ไซซ์ null วนครบรอบ quote → code_check                                : T20
--    เปลี่ยนชื่อ/ปิดทรง แล้วรหัสเก่ายังตรวจราคา ณ ตอนสร้างได้                      : T10 · T20
--    ปิดแล้วเปิด offer ใหม่ ประวัติราคาต่อเนื่อง                                    : T12
--    ราคาเปลี่ยนในวินาทีเดียวกับที่ออกรหัสไม่ทำให้เตือนผิด (effective +1 วินาที)     : T08b
--    จำนวนเม็ดที่มีแบบเดียวยังแสดง · เพิ่มแบบ 4 เม็ดแล้วขึ้นเอง (catalog อ่านจาก DB) : T04 · T22
--    แก้ชื่อ/ช่วงไซซ์/ลำดับหลัง publish ได้ (ไม่ถูกล็อกเกิน)                         : T13
--  migration-traps: ไม่มี overload (ข้อ 1) T01 · grant 4 ชื่อ (ข้อ 2/18) T01 · NaN (ข้อ 4) = ตัวเลขทุกช่องเป็น int/CHECK between T16 ·
--    ข้อ 19 (UPDATE ชน trigger) = ไม่เกี่ยว migration ไม่มี UPDATE ตารางเดิม · ข้อ 22 (now คงที่) = ใช้ clock_timestamp + pg_sleep
--  ข้อที่ **ไม่มีเทสต์ครอบใน SQL**: X2 X8 X16 X17 (ฝั่ง TS) · X19 ส่วน validator (P2) · ช่องว่างที่ SQL จำลองไม่ได้: race 2 connection พร้อมกัน
--    (rb_*_price_set พร้อมกัน/ออกเลขแบบพร้อมกัน — advisory lock + PK กันไว้ แต่ do-block ทรานแซกชันเดียวไม่มีสอง connection)
--  mutant (ตัดด่านชั่วคราวแล้วเทสต์ต้องล้ม): ไม่ได้ทำ — ใช้เทสต์เชิงพฤติกรรมตรงๆ แทน (ดูรายงาน)
-- ============================================================================

do $pre196$
begin
  if to_regclass('analytics.rb_design') is null then
    raise exception 'verify-0196: ยังไม่มีตาราง rb_* — dry-run ก่อน apply ต้องต่อไฟล์ migration + verify เป็นไฟล์เดียว (cat ... > ไฟล์รวม)';
  end if;
end;
$pre196$;

create temp table _vr (
  n      serial,
  name   text not null,
  ok     boolean,
  detail text
) on commit drop;

create temp table _ctx (shop uuid not null, actor uuid not null) on commit drop;

create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default '') returns void
language plpgsql as $f$
begin
  insert into _vr (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  raise notice '[live] % = %', p_name, case when coalesce(p_ok, false) then 'PASS' else 'FAIL / ' || coalesce(p_detail, '') end;
end
$f$;

create function pg_temp.skip(p_name text, p_detail text) returns void
language plpgsql as $f$
begin
  insert into _vr (name, ok, detail) values (p_name, null, p_detail);
  raise notice '[live] % = SKIP / %', p_name, p_detail;
end
$f$;

create function pg_temp.sh() returns uuid language sql as $f$ select shop from _ctx $f$;
create function pg_temp.ac() returns uuid language sql as $f$ select actor from _ctx $f$;

-- รันคำสั่งแล้วคืน 'OK' หรือ 'sqlstate:hint' (ไม่ให้ error ทะลุออกมาพังทั้งบล็อก)
create function pg_temp.t_try(p_sql text) returns text
language plpgsql as $f$
declare
  v_state text;
  v_hint text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  v_state := sqlstate;
  return v_state || ':' || coalesce(v_hint, '');
end
$f$;

-- ห่อ RPC (shop/actor จาก _ctx)
create function pg_temp.q(p_design int, p_size int, p_pos int[], p_at timestamptz default null) returns jsonb
language sql as $f$ select analytics.rb_quote(pg_temp.sh(), p_design, p_size, p_pos, p_at) $f$;

create function pg_temp.cc(p_design int, p_size int, p_pos int[], p_priced_at timestamptz, p_total int) returns jsonb
language sql as $f$ select analytics.rb_code_check(pg_temp.sh(), pg_temp.ac(), p_design, p_size, p_pos, p_priced_at, p_total) $f$;

create function pg_temp.mk_shape(p_name text, p_kind text) returns uuid
language sql as $f$ select (analytics.rb_shape_upsert(pg_temp.sh(), pg_temp.ac(), null, p_name, p_kind, 0) ->> 'id')::uuid $f$;

create function pg_temp.mk_stone(p_name text, p_short text, p_color text) returns uuid
language sql as $f$ select (analytics.rb_stone_upsert(pg_temp.sh(), pg_temp.ac(), null, p_name, p_short, p_color, 0) ->> 'id')::uuid $f$;

-- offer + ราคา (p_price null = ไม่ตั้งราคา)
create function pg_temp.mk_offer(p_stone uuid, p_shape uuid, p_major int, p_minor int, p_price int) returns uuid
language plpgsql as $f$
declare
  v_id uuid;
begin
  v_id := (analytics.rb_offer_upsert(pg_temp.sh(), pg_temp.ac(), p_stone, p_shape, p_major, p_minor) ->> 'id')::uuid;
  if p_price is not null then
    perform analytics.rb_offer_price_set(pg_temp.sh(), pg_temp.ac(), v_id, p_price);
  end if;
  return v_id;
end
$f$;

-- แบบ + ราคาตัวเรือน + (publish) · คืน id
create function pg_temp.mk_design(p_name text, p_count int, p_shape uuid, p_major int, p_minor int, p_axis text, p_smin int, p_smax int, p_body int, p_publish boolean) returns uuid
language plpgsql as $f$
declare
  v_id uuid;
begin
  v_id := (analytics.rb_design_upsert(pg_temp.sh(), pg_temp.ac(), null, p_name, p_count, p_shape, p_major, p_minor, p_axis, p_smin, p_smax, 0) ->> 'id')::uuid;
  if p_body is not null then
    perform analytics.rb_design_price_set(pg_temp.sh(), pg_temp.ac(), v_id, p_body);
  end if;
  if p_publish then
    perform analytics.rb_design_publish(pg_temp.sh(), pg_temp.ac(), v_id);
  end if;
  return v_id;
end
$f$;

create function pg_temp.dno(p_id uuid) returns int language sql as $f$ select design_no::int from analytics.rb_design where id = p_id $f$;
create function pg_temp.sno(p_id uuid) returns int language sql as $f$ select stone_no::int from analytics.rb_stone where id = p_id $f$;

-- แบบใน catalog (jsonb) ตามเลขแบบ · null ถ้าไม่โผล่
create function pg_temp.cat_design(p_cat jsonb, p_no int) returns jsonb
language sql as $f$ select e from jsonb_array_elements(p_cat -> 'designs') e where (e ->> 'no')::int = p_no $f$;

create function pg_temp.cat_price(p_cat jsonb, p_design int, p_stone int) returns int
language sql as $f$
  select (o ->> 'price_thb')::int from jsonb_array_elements(pg_temp.cat_design(p_cat, p_design) -> 'offers') o where (o ->> 'stone_no')::int = p_stone
$f$;

create function pg_temp.keys(p_j jsonb) returns text
language sql as $f$ select string_agg(k, ',' order by k) from jsonb_object_keys(p_j) k $f$;

-- สิทธิ์ EXECUTE ที่ไม่ควรมีบนฟังก์ชันใดก็ตามในสคีมา analytics (PUBLIC=grantee 0 · anon · authenticated) — logic เดียวกับ scripts/check-analytics-grants.sql ส่วนที่ 1
create function pg_temp.fn_leaks() returns int
language sql as $f$
select count(*)::int
from pg_proc p
cross join lateral aclexplode(p.proacl) a
where p.pronamespace = 'analytics'::regnamespace
  and a.privilege_type = 'EXECUTE'
  and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole)
$f$;

do $verify0196$
declare
  v_log text;
  v_pass int; v_skip int; v_fail int;
  v_shop uuid; v_actor uuid; v_staff uuid;
  v_sfx text := substr(md5(random()::text), 1, 5);

  sh_round uuid; sh_oval uuid; sh_drop uuid;
  st_a uuid; st_b uuid; st_c uuid;
  n_a int; n_b int; n_c int;
  of_a_round uuid; of_a_oval uuid; of_b_round uuid; of_b_3x3 uuid; of_c_205 uuid; of_c_drop uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; d6 uuid;
  n1 int; n2 int; n3 int; n4 int; n6 int;

  v_cat jsonb; v_q jsonb; v_q2 jsonb; v_cc jsonb; v_adm jsonb; v_j jsonb;
  v_t timestamptz; v_t0 timestamptz;
  v_s text; v_s2 text; v_s3 text; v_s4 text; v_s5 text;
  v_int int; v_int2 int;
  v_bool boolean; v_bool2 boolean; v_bool3 boolean;
  v_txt text;
  r record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- ร้าน + ผู้ทำรายการ owner/admin จริง (ข้อมูลเดิมของ DB — ไม่สร้างสมาชิกใหม่)
  select m.shop_id, m.user_id into v_shop, v_actor from public.shop_member m where m.role in ('owner', 'admin') order by m.role, m.user_id limit 1;
  select m.user_id into v_staff from public.shop_member m where m.shop_id = v_shop and m.role not in ('owner', 'admin') limit 1;
  if v_shop is null then
    raise exception 'verify-0196: ไม่มีสมาชิก owner/admin ใน DB — ทดสอบไม่ได้';
  end if;
  insert into _ctx values (v_shop, v_actor);

  -- --------------------------------------------------------------------
  -- T01 — สิทธิ์/overload (ข้อ 1/2/7/18)
  -- --------------------------------------------------------------------
  select count(*) into v_int from (select proname from pg_proc where pronamespace = 'analytics'::regnamespace and proname like 'rb\_%' group by proname having count(*) > 1) d;
  perform pg_temp.chk('T01a (ไม่มี overload ของ rb_*)', v_int = 0, 'dup=' || v_int);
  select count(*) into v_int from pg_proc where pronamespace = 'analytics'::regnamespace and proname like 'rb\_%';
  perform pg_temp.chk('T01b (จำนวนฟังก์ชัน rb_* = 23: 15 RPC/helper สาธารณะ + 8 ภายใน)', v_int = 23, 'n=' || v_int);
  perform pg_temp.chk('T01c (ไม่มี EXECUTE ให้ PUBLIC/anon/authenticated บนฟังก์ชันใดในสคีมา analytics)', pg_temp.fn_leaks() = 0, 'leaks=' || pg_temp.fn_leaks());
  select count(*) into v_int from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace
     and p.proname in ('rb_public_catalog','rb_quote','rb_size_range','rb_shape_upsert','rb_stone_upsert','rb_offer_upsert','rb_offer_price_set','rb_design_upsert','rb_design_price_set','rb_design_card_set','rb_design_publish','rb_design_duplicate','rb_set_active','rb_admin_catalog','rb_code_check')
     and not has_function_privilege('service_role', p.oid, 'execute');
  perform pg_temp.chk('T01d (RPC ทั้ง 15 ตัว service_role execute ได้)', v_int = 0, 'missing=' || v_int);
  select count(*) into v_int from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace
     and p.proname in ('rb_text_ok','rb_append_only','rb_deny_truncate','rb_shape_guard','rb_design_guard','rb_stone_guard','rb_offer_guard','rb_require_office')
     and has_function_privilege('service_role', p.oid, 'execute');
  perform pg_temp.chk('T01e (helper/trigger ภายใน 8 ตัว service_role execute ไม่ได้)', v_int = 0, 'leak=' || v_int);

  -- ตาราง: service_role select ได้อย่างเดียว · anon/authenticated ไม่มีอะไรเลย (X7)
  select count(*) into v_int
    from unnest(array['rb_gem_shape','rb_design','rb_design_price','rb_stone','rb_stone_offer','rb_offer_price']) t
   where not has_table_privilege('service_role', 'analytics.' || t, 'select')
      or has_table_privilege('service_role', 'analytics.' || t, 'insert')
      or has_table_privilege('service_role', 'analytics.' || t, 'update')
      or has_table_privilege('service_role', 'analytics.' || t, 'delete')
      or has_table_privilege('service_role', 'analytics.' || t, 'truncate')
      or has_table_privilege('service_role', 'analytics.' || t, 'maintain')
      or has_table_privilege('service_role', 'analytics.' || t, 'references')
      or has_table_privilege('service_role', 'analytics.' || t, 'trigger')
      or has_table_privilege('anon', 'analytics.' || t, 'select')
      or has_table_privilege('authenticated', 'analytics.' || t, 'select');
  perform pg_temp.chk('T01f (ตาราง rb_* 6 ตัว: service_role = select อย่างเดียว · anon/authenticated ไม่มีสิทธิ์)', v_int = 0, 'bad=' || v_int);
  select count(*) into v_int from pg_tables where schemaname = 'analytics' and tablename like 'rb\_%' and rowsecurity;
  perform pg_temp.chk('T01g (RLS เปิดทั้ง 6 ตาราง)', v_int = 6, 'n=' || v_int);
  select count(*) into v_int from pg_policies where schemaname = 'analytics' and tablename like 'rb\_%';
  perform pg_temp.chk('T01h (ไม่มี policy บนตาราง rb_*)', v_int = 0, 'n=' || v_int);

  -- --------------------------------------------------------------------
  -- T02 — X1: ต้นทุนพลอยของ 0190 เข้าไม่ถึงจาก service_role
  -- --------------------------------------------------------------------
  v_bool := has_table_privilege('service_role', 'analytics.gem_item_price', 'select');
  perform pg_temp.chk('T02a (X1: service_role ไม่มีสิทธิ์ select analytics.gem_item_price — ถ้า true กลไก INVOKER ไม่พอพิสูจน์ ต้องรายงานกลับ)', v_bool is false, 'has_select=' || coalesce(v_bool::text, 'null'));

  -- พิสูจน์พฤติกรรม: ฟังก์ชัน INVOKER ที่ join ตารางต้นทุน เรียกใต้ service_role → 42501
  create function analytics._rb_x1_probe() returns int language sql as 'select count(*)::int from analytics.gem_item_price';
  grant execute on function analytics._rb_x1_probe() to service_role;
  v_s := 'not_run';
  set local role service_role;
  begin
    perform analytics._rb_x1_probe();
    v_s := 'OK(leak)';
  exception when insufficient_privilege then
    v_s := 'denied';
  when others then
    v_s := 'other:' || sqlstate;
  end;
  reset role;
  drop function analytics._rb_x1_probe();
  perform pg_temp.chk('T02b (X1: INVOKER ที่อ้าง gem_item_price ใต้ service_role → 42501 — กำแพงทำงานจริง)', v_s = 'denied', v_s);

  select (not p.prosecdef) into v_bool from pg_proc p where p.oid = 'analytics.rb_public_catalog(uuid,timestamptz)'::regprocedure;
  select (not p.prosecdef) into v_bool2 from pg_proc p where p.oid = 'analytics.rb_quote(uuid,integer,integer,integer[],timestamptz)'::regprocedure;
  v_txt := pg_get_functiondef('analytics.rb_public_catalog(uuid,timestamptz)'::regprocedure) || pg_get_functiondef('analytics.rb_quote(uuid,integer,integer,integer[],timestamptz)'::regprocedure);
  perform pg_temp.chk('T02c (X1: rb_public_catalog/rb_quote เป็น INVOKER · ตัวฟังก์ชันไม่อ้าง gem_item/security definer)',
    v_bool and v_bool2 and v_txt !~* 'gem_item|security definer|cost|margin', format('invoker=%s/%s', v_bool, v_bool2));

  -- --------------------------------------------------------------------
  -- T03 — allowlist ของข้อมูลสาธารณะ (X1/X20) · คอลัมน์ต้นทุนไม่มีในตาราง rb_*
  -- --------------------------------------------------------------------
  select count(*) into v_int from information_schema.columns
   where table_schema = 'analytics' and table_name like 'rb\_%' and column_name ~* 'cost|margin|buy|wholesale|ต้นทุน|กำไร';
  perform pg_temp.chk('T03a (X1: ตาราง rb_* ไม่มีคอลัมน์ชื่อ cost/margin/buy/wholesale)', v_int = 0, 'n=' || v_int);

  -- --------------------------------------------------------------------
  -- Fixture (ผ่าน RPC เท่านั้น) — ตัวเลข 480/500/80/120/150 เป็นตัวอย่าง
  -- --------------------------------------------------------------------
  sh_round := pg_temp.mk_shape('กลม-' || v_sfx, 'round');
  sh_oval := pg_temp.mk_shape('ไข่-' || v_sfx, 'oval');
  sh_drop := pg_temp.mk_shape('หยด-' || v_sfx, 'oval');
  st_a := pg_temp.mk_stone('โกเมน-' || v_sfx, 'โกเมน', '#7A1F2B');
  st_b := pg_temp.mk_stone('ซิทริน-' || v_sfx, 'ซิทริน', '#e3a82b');
  st_c := pg_temp.mk_stone('พลอยซี-' || v_sfx, 'พลอยซี', '#1E9E6A');
  n_a := pg_temp.sno(st_a); n_b := pg_temp.sno(st_b); n_c := pg_temp.sno(st_c);

  of_a_round := pg_temp.mk_offer(st_a, sh_round, 200, 200, 80);
  of_a_oval := pg_temp.mk_offer(st_a, sh_oval, 400, 300, 120);
  of_b_round := pg_temp.mk_offer(st_b, sh_round, 200, 200, 80);
  of_b_3x3 := pg_temp.mk_offer(st_b, sh_round, 300, 300, null);   -- offer ไม่มีแถวราคา = ไม่ใช่ 0
  of_c_205 := pg_temp.mk_offer(st_c, sh_round, 205, 205, 90);     -- X10: 2.05 ≠ 2.00
  of_c_drop := pg_temp.mk_offer(st_c, sh_drop, 400, 300, 150);    -- X11: ขนาดตรงไข่ แต่เป็นทรงอื่น

  d1 := pg_temp.mk_design('ทดสอบ-ก-' || v_sfx, 5, sh_round, 200, 200, null, 45, 68, 480, true);
  d2 := pg_temp.mk_design('ทดสอบ-ข-' || v_sfx, 7, sh_oval, 400, 300, 'across_row', 53, 68, 500, true);
  d3 := pg_temp.mk_design('ทดสอบ-ร่าง-' || v_sfx, 3, sh_round, 200, 200, null, 45, 68, 300, false);
  d4 := pg_temp.mk_design('ทดสอบ-ค-' || v_sfx, 5, sh_round, 300, 300, null, 45, 68, 600, true);
  d6 := pg_temp.mk_design('ทดสอบ-ง-' || v_sfx, 3, sh_round, 200, 200, null, 45, 68, 262143, true);
  n1 := pg_temp.dno(d1); n2 := pg_temp.dno(d2); n3 := pg_temp.dno(d3); n4 := pg_temp.dno(d4); n6 := pg_temp.dno(d6);

  -- ราคาใหม่ effective_from = วินาทีถัดไป → รอให้มีผลก่อนทดสอบเส้นทาง p_at = null
  perform pg_sleep(1.3);
  v_t0 := date_trunc('second', clock_timestamp());

  v_cat := analytics.rb_public_catalog(v_shop);

  perform pg_temp.chk('T03b (key ระดับบนของ catalog = allowlist เป๊ะ)', pg_temp.keys(v_cat) = 'catalog_at,designs,sizes,stones', pg_temp.keys(v_cat));
  perform pg_temp.chk('T03c (key ของแบบ = allowlist เป๊ะ · ไม่มี id/is_active/published_at)',
    pg_temp.keys(pg_temp.cat_design(v_cat, n1)) = 'body_price_thb,card_image_path,major_mm100,minor_mm100,name,no,offers,shape_kind,shape_name,size_max,size_min,stone_axis,stone_count',
    pg_temp.keys(pg_temp.cat_design(v_cat, n1)));
  perform pg_temp.chk('T03d (key ของ offer/พลอย/sizes = allowlist เป๊ะ)',
    pg_temp.keys(pg_temp.cat_design(v_cat, n1) -> 'offers' -> 0) = 'price_thb,stone_no'
    and pg_temp.keys(v_cat -> 'stones' -> 0) = 'color_hex,name,no,short_name'
    and pg_temp.keys(v_cat -> 'sizes') = 'max,min'
    and (v_cat -> 'sizes' ->> 'min') = '45' and (v_cat -> 'sizes' ->> 'max') = '68');
  v_q := pg_temp.q(n1, 54, array[n_a, 0, n_b, 0, n_a]);
  perform pg_temp.chk('T03e (key ของ quote สำเร็จ/แถว = allowlist เป๊ะ · total = 480+80+80+80 = 720)',
    pg_temp.keys(v_q) = 'body,design,lines,ok,priced_at,size,total' and pg_temp.keys(v_q -> 'lines' -> 0) = 'name,pos,price,stone_no'
    and (v_q ->> 'total') = '720' and (v_q ->> 'body') = '480', pg_temp.keys(v_q) || ' total=' || coalesce(v_q ->> 'total', 'null'));

  -- --------------------------------------------------------------------
  -- T04 — การมองเห็น/ราคาตามทรง×ขนาด (X3 · X10 · X11) + ต้องไม่พัง (ชนิดเดียวราคากลม≠ไข่ · CZ ล้วน)
  -- --------------------------------------------------------------------
  perform pg_temp.chk('T04a (พลอยชนิดเดียวมีราคากลมและไข่ → แบบกลมได้ 80 · แบบไข่ได้ 120)',
    pg_temp.cat_price(v_cat, n1, n_a) = 80 and pg_temp.cat_price(v_cat, n2, n_a) = 120);
  perform pg_temp.chk('T04b (X10: offer 2.05 ไม่โผล่ในแบบ 2.00 · offer 3×3 ไม่มีราคา ไม่โผล่ในแบบ 3×3 · A 2×2 ไม่โผล่ใน 3×3)',
    pg_temp.cat_price(v_cat, n1, n_c) is null and pg_temp.cat_price(v_cat, n4, n_b) is null and pg_temp.cat_price(v_cat, n4, n_a) is null);
  perform pg_temp.chk('T04c (X11: พลอยที่มีแต่ทรงหยด 4×3 ไม่โผล่ในแบบไข่ 4×3 · พลอยทรงอื่นไม่ปน)',
    pg_temp.cat_price(v_cat, n2, n_c) is null and pg_temp.cat_price(v_cat, n2, n_b) is null);
  perform pg_temp.chk('T04d (แบบ 3×3 ไม่มีพลอยสีเลย (CZ ล้วน) ยังโผล่ใน catalog พร้อม offers ว่าง)',
    pg_temp.cat_design(v_cat, n4) is not null and jsonb_array_length(pg_temp.cat_design(v_cat, n4) -> 'offers') = 0);
  perform pg_temp.chk('T04e (พลอยที่ไม่ขายได้ในแบบใดเลย (C) ไม่อยู่ในรายการ stones สาธารณะ · A และ B อยู่)',
    not exists (select 1 from jsonb_array_elements(v_cat -> 'stones') s where (s ->> 'no')::int = n_c)
    and exists (select 1 from jsonb_array_elements(v_cat -> 'stones') s where (s ->> 'no')::int = n_a)
    and exists (select 1 from jsonb_array_elements(v_cat -> 'stones') s where (s ->> 'no')::int = n_b));
  v_q := pg_temp.q(n1, 54, array[n_c, 0, 0, 0, 0]);
  perform pg_temp.chk('T04f (X3/X10: quote พลอยที่ขนาดไม่ตรง → stone_unavailable + stone_nos [C])', v_q ->> 'code' = 'stone_unavailable' and (v_q -> 'stone_nos') = to_jsonb(array[n_c]), v_q::text);
  v_q := pg_temp.q(n4, 54, array[n_b, n_a, 0, 0, 0]);
  perform pg_temp.chk('T04g (X3: offer ไม่มีแถวราคา = ไม่ใช่ 0 → stone_unavailable [A,B] ไม่คิด 0 เงียบๆ)', v_q ->> 'code' = 'stone_unavailable' and (v_q -> 'stone_nos') = to_jsonb(array[least(n_a, n_b), greatest(n_a, n_b)]), v_q::text);
  v_q := pg_temp.q(n4, null, array[0, 0, 0, 0, 0]);
  perform pg_temp.chk('T04h (CZ ล้วนออกราคา = ราคาตัวเรือนล้วน 600 · บรรทัด CZ ราคา 0 ชื่อ null ให้ TS เติม)',
    (v_q ->> 'ok') = 'true' and (v_q ->> 'total') = '600' and (v_q -> 'lines' -> 0 ->> 'price') = '0' and (v_q -> 'lines' -> 0 -> 'name') = 'null'::jsonb, v_q::text);
  v_q := pg_temp.q(n2, 60, array[n_b, 0, 0, 0, 0, 0, 0]);
  perform pg_temp.chk('T04i (X3: ทรงไข่ไม่มี offer ของ B → stone_unavailable [B])', v_q ->> 'code' = 'stone_unavailable' and (v_q -> 'stone_nos') = to_jsonb(array[n_b]), v_q::text);
  v_q := pg_temp.q(n2, 60, array[n_a, n_a, 0, 0, 0, 0, 0]);
  perform pg_temp.chk('T04j (แบบไข่ 7 เม็ด: 500 + 120×2 = 740)', (v_q ->> 'total') = '740', v_q::text);

  -- --------------------------------------------------------------------
  -- T05 — X3: ปิดพลอยหลังโหลดหน้า → quote ปฏิเสธ · catalog ไม่ส่ง · เปิดกลับได้
  -- --------------------------------------------------------------------
  perform analytics.rb_set_active(v_shop, v_actor, 'stone', st_a, false);
  v_q := pg_temp.q(n1, 54, array[n_a, 0, 0, 0, 0]);
  v_cat := analytics.rb_public_catalog(v_shop);
  perform pg_temp.chk('T05a (พลอยปิด → quote stone_unavailable [A] · catalog ไม่มี A)',
    v_q ->> 'code' = 'stone_unavailable' and (v_q -> 'stone_nos') = to_jsonb(array[n_a])
    and not exists (select 1 from jsonb_array_elements(v_cat -> 'stones') s where (s ->> 'no')::int = n_a), v_q::text);
  perform analytics.rb_set_active(v_shop, v_actor, 'stone', st_a, true);
  perform analytics.rb_set_active(v_shop, v_actor, 'offer', of_a_round, false);
  v_q := pg_temp.q(n1, 54, array[n_a, 0, 0, 0, 0]);
  perform pg_temp.chk('T05b (offer ปิด → stone_unavailable แต่ไข่ยังขายได้)', v_q ->> 'code' = 'stone_unavailable' and (pg_temp.q(n2, 60, array[n_a, 0, 0, 0, 0, 0, 0]) ->> 'ok') = 'true', v_q::text);
  perform analytics.rb_set_active(v_shop, v_actor, 'offer', of_a_round, true);
  perform pg_temp.chk('T05c (เปิดกลับแล้วขายได้ 80 เหมือนเดิม)', (pg_temp.q(n1, 54, array[n_a, 0, 0, 0, 0]) ->> 'total') = '560');

  -- --------------------------------------------------------------------
  -- T06 — X4 จำนวนเม็ด + รูปร่าง input
  -- --------------------------------------------------------------------
  perform pg_temp.chk('T06a (X4: n=2/4/6/8 ≠ 5 → count_mismatch)',
    (pg_temp.q(n1, 54, array[0, 0]) ->> 'code') = 'count_mismatch' and (pg_temp.q(n1, 54, array[0, 0, 0, 0]) ->> 'code') = 'count_mismatch'
    and (pg_temp.q(n1, 54, array[0, 0, 0, 0, 0, 0]) ->> 'code') = 'count_mismatch' and (pg_temp.q(n1, 54, array[0, 0, 0, 0, 0, 0, 0, 0]) ->> 'code') = 'count_mismatch');
  perform pg_temp.chk('T06b (invalid: null array · ว่าง ธาตุ null · ติดลบ · 1024 · 2 มิติ · design_no 0/4096/null · shop null)',
    (pg_temp.q(n1, 54, null) ->> 'code') = 'invalid' and (pg_temp.q(n1, 54, '{}'::int[]) ->> 'code') = 'invalid'
    and (pg_temp.q(n1, 54, array[0, null, 0, 0, 0]) ->> 'code') = 'invalid' and (pg_temp.q(n1, 54, array[0, -1, 0, 0, 0]) ->> 'code') = 'invalid'
    and (pg_temp.q(n1, 54, array[0, 1024, 0, 0, 0]) ->> 'code') = 'invalid' and (pg_temp.q(n1, 54, array[[0, 0], [0, 0]]) ->> 'code') = 'invalid'
    and (pg_temp.q(0, 54, array[0, 0, 0, 0, 0]) ->> 'code') = 'invalid' and (pg_temp.q(4096, 54, array[0, 0, 0, 0, 0]) ->> 'code') = 'invalid'
    and (pg_temp.q(null, 54, array[0, 0, 0, 0, 0]) ->> 'code') = 'invalid'
    and (analytics.rb_quote(null, n1, 54, array[0, 0, 0, 0, 0]) ->> 'code') = 'invalid');
  perform pg_temp.chk('T06c (เลขแบบที่ไม่มี → design_unavailable · ร้านอื่น → design_unavailable)',
    (pg_temp.q(4000, 54, array[0, 0, 0, 0, 0]) ->> 'code') = 'design_unavailable'
    and (analytics.rb_quote(gen_random_uuid(), n1, 54, array[0, 0, 0, 0, 0]) ->> 'code') = 'design_unavailable');

  -- --------------------------------------------------------------------
  -- T07 — X5 ไซซ์
  -- --------------------------------------------------------------------
  perform pg_temp.chk('T07a (ไซซ์ 44/69/0/-1/1000 → size_out_of_range · 45/68 ผ่านในแบบ 45-68)',
    (pg_temp.q(n1, 44, array[0, 0, 0, 0, 0]) ->> 'code') = 'size_out_of_range' and (pg_temp.q(n1, 69, array[0, 0, 0, 0, 0]) ->> 'code') = 'size_out_of_range'
    and (pg_temp.q(n1, 0, array[0, 0, 0, 0, 0]) ->> 'code') = 'size_out_of_range' and (pg_temp.q(n1, -1, array[0, 0, 0, 0, 0]) ->> 'code') = 'size_out_of_range'
    and (pg_temp.q(n1, 1000, array[0, 0, 0, 0, 0]) ->> 'code') = 'size_out_of_range'
    and (pg_temp.q(n1, 45, array[0, 0, 0, 0, 0]) ->> 'ok') = 'true' and (pg_temp.q(n1, 68, array[0, 0, 0, 0, 0]) ->> 'ok') = 'true');
  perform pg_temp.chk('T07b (Q3: แบบช่วง 53-68 — 52 ปฏิเสธ · 53 ผ่าน · null (ให้แอดมินเช็ก) ผ่าน)',
    (pg_temp.q(n2, 52, array[0, 0, 0, 0, 0, 0, 0]) ->> 'code') = 'size_out_of_range' and (pg_temp.q(n2, 53, array[0, 0, 0, 0, 0, 0, 0]) ->> 'ok') = 'true'
    and (pg_temp.q(n2, null, array[0, 0, 0, 0, 0, 0, 0]) ->> 'ok') = 'true' and (pg_temp.q(n2, null, array[0, 0, 0, 0, 0, 0, 0]) -> 'size') = 'null'::jsonb);

  -- --------------------------------------------------------------------
  -- T08 — X6 ราคาเปลี่ยนหลังออกรหัส (ตรวจย้อนได้ทั้งสองราคา) + ประวัติ insert-only
  -- --------------------------------------------------------------------
  v_t := date_trunc('second', clock_timestamp());                       -- ณ วินาทีที่ "ลูกค้าได้รหัส" (ราคาเก่า 720)
  v_q := pg_temp.q(n1, 54, array[n_a, 0, n_b, 0, n_a]);
  v_s := v_q ->> 'priced_at';
  perform analytics.rb_design_price_set(v_shop, v_actor, d1, 500);       -- 480 → 500
  perform analytics.rb_offer_price_set(v_shop, v_actor, of_a_round, 100); -- 80 → 100
  perform pg_sleep(1.3);
  v_q2 := pg_temp.q(n1, 54, array[n_a, 0, n_b, 0, n_a]);
  perform pg_temp.chk('T08a (หลังแก้ราคา quote สดได้ราคาใหม่ 500+100+80+100 = 780 · priced_at ขยับ)', (v_q2 ->> 'total') = '780' and (v_q2 ->> 'priced_at') > v_s, v_q2::text);
  v_q2 := pg_temp.q(n1, 54, array[n_a, 0, n_b, 0, n_a], v_t);
  perform pg_temp.chk('T08b (p_at = วินาทีที่ออกรหัสเดิม → ราคาเก่า 720 ตรงกับที่ลูกค้าเห็น — ราคาใหม่ที่ตั้งในวินาทีเดียวกันไม่ย้อนเข้าไป)', (v_q2 ->> 'total') = '720', v_q2::text);
  v_cc := pg_temp.cc(n1, 54, array[n_a, 0, n_b, 0, n_a], v_t, 720);
  perform pg_temp.chk('T08c (code_check: ตอนสร้าง 720 · ปัจจุบัน 780 · signed_total_match · ส่วนต่างรายบรรทัด)',
    (v_cc -> 'creation' ->> 'total') = '720' and (v_cc -> 'current' ->> 'total') = '780' and (v_cc ->> 'signed_total_match') = 'true'
    and (v_cc -> 'creation' ->> 'body') = '480' and (v_cc -> 'current' ->> 'body') = '500'
    and (v_cc -> 'creation' -> 'lines' -> 0 ->> 'price') = '80' and (v_cc -> 'current' -> 'lines' -> 0 ->> 'price') = '100', v_cc::text);
  v_cc := pg_temp.cc(n1, 54, array[n_a, 0, n_b, 0, n_a], v_t, 721);
  perform pg_temp.chk('T08d (signed_total ที่ไม่ตรงกับประวัติ → signed_total_match = false)', (v_cc ->> 'signed_total_match') = 'false');

  v_s := pg_temp.t_try(format('update analytics.rb_design_price set body_price_thb = 1 where design_id = %L', d1));
  v_s2 := pg_temp.t_try(format('delete from analytics.rb_design_price where design_id = %L', d1));
  v_s3 := pg_temp.t_try(format('update analytics.rb_offer_price set price_thb = 1 where offer_id = %L', of_a_round));
  v_s4 := pg_temp.t_try(format('delete from analytics.rb_offer_price where offer_id = %L', of_a_round));
  v_s5 := pg_temp.t_try('truncate analytics.rb_offer_price');
  perform pg_temp.chk('T08e (X6: UPDATE/DELETE/TRUNCATE ตารางราคา = 55000 append_only/no_truncate แม้ผู้ทำเป็นเจ้าของตาราง)',
    v_s = '55000:append_only' and v_s2 = '55000:append_only' and v_s3 = '55000:append_only' and v_s4 = '55000:append_only' and v_s5 = '55000:no_truncate',
    v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4 || ' ' || v_s5);
  v_s := pg_temp.t_try('truncate analytics.rb_design_price');
  v_s2 := pg_temp.t_try('truncate analytics.rb_design');
  v_s3 := pg_temp.t_try('truncate analytics.rb_stone_offer');
  perform pg_temp.chk('T08f (TRUNCATE ตารางอื่นของ rb_* ล้มเช่นกัน)', v_s <> 'OK' and v_s2 <> 'OK' and v_s3 <> 'OK', v_s || ' ' || v_s2 || ' ' || v_s3);

  v_j := analytics.rb_design_price_set(v_shop, v_actor, d1, 500);
  perform pg_temp.chk('T08g (ราคาเท่าล่าสุด → unchanged ไม่เขียนแถวซ้ำ)', (v_j ->> 'unchanged') = 'true');
  select count(*) into v_int from analytics.rb_design_price where design_id = d1;
  perform pg_temp.chk('T08h (ประวัติราคาตัวเรือน d1 = 2 แถว (480 · 500) ไม่ถูกทับ)', v_int = 2, 'rows=' || v_int);
  perform analytics.rb_design_price_set(v_shop, v_actor, d1, 510);
  v_s := pg_temp.t_try(format('select analytics.rb_design_price_set(%L, %L, %L, 520)', v_shop, v_actor, d1));
  perform pg_temp.chk('T08i (ตั้งราคาแถวที่ 2 ภายในวินาทีเดียวกัน → price_too_fast ไม่ชน PK เงียบๆ)', v_s = '22023:price_too_fast', v_s);

  -- --------------------------------------------------------------------
  -- T09 — X7 ไม่มีช่องเขียนสาธารณะ: service_role เขียนตรงไม่ได้ · RPC สาธารณะอ่านได้ใต้ service_role และไม่แก้อะไร
  -- --------------------------------------------------------------------
  select count(*) into v_int from analytics.rb_design;
  v_s := 'not_run'; v_s2 := 'not_run'; v_s3 := 'not_run'; v_s4 := 'not_run'; v_s5 := 'not_run';
  set local role service_role;
  begin insert into analytics.rb_gem_shape (shop_id, name_th, render_kind) values (gen_random_uuid(), 'x1', 'round'); v_s := 'OK(leak)'; exception when insufficient_privilege then v_s := 'denied'; when others then v_s := 'other:' || sqlstate; end;
  begin update analytics.rb_design set name = 'x' where false; v_s2 := 'OK(leak)'; exception when insufficient_privilege then v_s2 := 'denied'; when others then v_s2 := 'other:' || sqlstate; end;
  begin delete from analytics.rb_offer_price where false; v_s3 := 'OK(leak)'; exception when insufficient_privilege then v_s3 := 'denied'; when others then v_s3 := 'other:' || sqlstate; end;
  begin v_j := analytics.rb_public_catalog(v_shop); v_s4 := case when jsonb_typeof(v_j) = 'object' then 'OK' else 'bad' end; exception when others then v_s4 := 'other:' || sqlstate; end;
  begin v_j := analytics.rb_quote(v_shop, n1, 54, array[0, 0, 0, 0, 0]); v_s5 := case when (v_j ->> 'ok') = 'true' then 'OK' else 'bad' end; exception when others then v_s5 := 'other:' || sqlstate; end;
  reset role;
  perform pg_temp.chk('T09a (X7: service_role insert/update/delete ตรง = 42501 · RPC สาธารณะทำงานใต้ service_role ได้ (select พอ))',
    v_s = 'denied' and v_s2 = 'denied' and v_s3 = 'denied' and v_s4 = 'OK' and v_s5 = 'OK', v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4 || ' ' || v_s5);
  select count(*) into v_int2 from analytics.rb_design;
  perform pg_temp.chk('T09b (เรียก RPC สาธารณะแล้วจำนวนแถวไม่ขยับ)', v_int = v_int2);

  -- anon/authenticated: เรียก RPC ทุกตัวไม่ได้ (ส่ง null ทุกพารามิเตอร์ได้ปลอดภัย — เช็ค EXECUTE ก่อน body · ข้อ 18.5)
  v_s := 'ok';
  foreach v_txt in array array['anon', 'authenticated'] loop
    for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in
      ('rb_public_catalog','rb_quote','rb_shape_upsert','rb_stone_upsert','rb_offer_upsert','rb_offer_price_set','rb_design_upsert','rb_design_price_set','rb_design_card_set','rb_design_publish','rb_design_duplicate','rb_set_active','rb_admin_catalog','rb_code_check') loop
      if has_function_privilege(v_txt, r.sig, 'execute') then v_s := 'leak:' || v_txt || ':' || r.sig::text; end if;
    end loop;
  end loop;
  perform pg_temp.chk('T09c (anon/authenticated ไม่มี EXECUTE บน RPC ใดเลย)', v_s = 'ok', v_s);
  -- จำลองวันที่กำแพงชั้นนอกหลุด: เปิด usage กลับให้ authenticated แล้วยิงจริง → ต้อง 42501 ที่ฟังก์ชัน (ข้อ 18.5)
  grant usage on schema analytics to authenticated;
  v_s := 'not_run'; v_s2 := 'not_run';
  set local role authenticated;
  begin perform analytics.rb_public_catalog(null, null); v_s := 'OK(leak)'; exception when insufficient_privilege then v_s := 'denied'; when others then v_s := 'other:' || sqlstate; end;
  begin perform analytics.rb_design_publish(null, null, null); v_s2 := 'OK(leak)'; exception when insufficient_privilege then v_s2 := 'denied'; when others then v_s2 := 'other:' || sqlstate; end;
  reset role;
  revoke usage on schema analytics from authenticated;
  perform pg_temp.chk('T09d (กำแพงชั้นนอกหลุด: authenticated ยิง RPC ตรง → 42501 ที่ฟังก์ชัน)', v_s = 'denied' and v_s2 = 'denied', v_s || ' ' || v_s2);

  -- --------------------------------------------------------------------
  -- T10 — X9 ทรงถูกปิด แต่แบบ/offer ยังเปิดอยู่ · ต้องไม่พัง: รหัสเก่ายังตรวจราคา ณ ตอนสร้างได้
  -- --------------------------------------------------------------------
  v_j := analytics.rb_set_active(v_shop, v_actor, 'shape', sh_round, false);
  v_cat := analytics.rb_public_catalog(v_shop);
  v_q := pg_temp.q(n1, 54, array[n_a, 0, n_b, 0, n_a]);
  perform pg_temp.chk('T10a (X9: ปิดทรงกลม → แบบกลมทุกแบบหายจาก catalog · quote design_unavailable · แบบไข่ยังอยู่ · คืน affected_designs = 3)',
    pg_temp.cat_design(v_cat, n1) is null and pg_temp.cat_design(v_cat, n4) is null and pg_temp.cat_design(v_cat, n2) is not null
    and v_q ->> 'code' = 'design_unavailable' and (v_j ->> 'affected_designs')::int = 3, v_q::text || ' ' || v_j::text);
  v_cc := pg_temp.cc(n1, 54, array[n_a, 0, n_b, 0, n_a], v_t, 720);
  perform pg_temp.chk('T10b (ต้องไม่พัง: ทรงปิดแล้ว rb_code_check ยังคิดราคา ณ ตอนสร้าง 720 ได้ · shape_active=false)',
    (v_cc ->> 'found') = 'true' and (v_cc -> 'creation' ->> 'total') = '720' and (v_cc -> 'design' ->> 'shape_active') = 'false', v_cc::text);
  perform analytics.rb_shape_upsert(v_shop, v_actor, sh_round, 'กลม2-' || v_sfx, null, 0);
  v_cc := pg_temp.cc(n1, 54, array[n_a, 0, n_b, 0, n_a], v_t, 720);
  perform pg_temp.chk('T10c (ต้องไม่พัง: เปลี่ยนชื่อทรงแล้วรหัสเก่ายังตรวจได้)', (v_cc -> 'creation' ->> 'total') = '720' and (v_cc -> 'design' ->> 'shape_name') like 'กลม2-%');
  perform analytics.rb_set_active(v_shop, v_actor, 'shape', sh_round, true);
  perform pg_temp.chk('T10d (เปิดทรงกลับ → แบบกลับมาขายได้ทันที)', (pg_temp.q(n1, 54, array[0, 0, 0, 0, 0]) ->> 'ok') = 'true');

  -- --------------------------------------------------------------------
  -- T11 — X12 ทรง × มิติ × ทิศ
  -- --------------------------------------------------------------------
  v_s := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,null,%L,5,%L,300,200,null,45,68,0)', v_shop, v_actor, 'ผิด1-' || v_sfx, sh_round));
  v_s2 := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,null,%L,5,%L,300,300,%L,45,68,0)', v_shop, v_actor, 'ผิด2-' || v_sfx, sh_oval, 'along_row'));
  v_s3 := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,null,%L,5,%L,400,300,null,45,68,0)', v_shop, v_actor, 'ผิด3-' || v_sfx, sh_oval));
  v_s4 := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,null,%L,5,%L,200,200,%L,45,68,0)', v_shop, v_actor, 'ผิด4-' || v_sfx, sh_round, 'along_row'));
  perform pg_temp.chk('T11a (X12: กลม major≠minor · ไข่ major=minor · ไข่ไม่มีทิศ · กลมมีทิศ → 22023)',
    v_s = '22023:shape_dims_invalid' and v_s2 = '22023:shape_dims_invalid' and v_s3 = '22023:axis_required' and v_s4 = '22023:axis_not_allowed', v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4);
  v_j := analytics.rb_design_upsert(v_shop, v_actor, null, 'สลับ-' || v_sfx, 5, sh_oval, 300, 400, 'along_row', 45, 68, 0);
  select d.stone_major_mm100::int, d.stone_minor_mm100::int into v_int, v_int2 from analytics.rb_design d where d.id = (v_j ->> 'id')::uuid;
  perform pg_temp.chk('T11b (ไข่พิมพ์ 3×4 → เก็บ canonical major=400 minor=300)', v_int = 400 and v_int2 = 300, v_int || 'x' || v_int2);
  v_s := pg_temp.t_try(format('select analytics.rb_offer_upsert(%L,%L,%L,%L,300,400)', v_shop, v_actor, st_a, sh_round));
  v_s2 := pg_temp.t_try(format('select analytics.rb_offer_upsert(%L,%L,%L,%L,300,300)', v_shop, v_actor, st_a, sh_oval));
  perform pg_temp.chk('T11c (offer กลม 3×4 · offer ไข่ 3×3 → 22023 shape_dims_invalid)', v_s = '22023:shape_dims_invalid' and v_s2 = '22023:shape_dims_invalid', v_s || ' ' || v_s2);
  v_s := pg_temp.t_try(format('insert into analytics.rb_design (shop_id, design_no, name, stone_count, shape_id, stone_major_mm100, stone_minor_mm100, size_min, size_max) values (%L, 4090, %L, 5, %L, 200, 300, 45, 68)', v_shop, 'ตรง1-' || v_sfx, sh_round));
  v_s2 := pg_temp.t_try(format('insert into analytics.rb_stone_offer (shop_id, stone_id, shape_id, major_mm100, minor_mm100) values (%L, %L, %L, 200, 300)', v_shop, st_a, sh_round));
  perform pg_temp.chk('T11d (X12: เขียนตรง major<minor → CHECK 23514)', v_s <> 'OK' and v_s2 <> 'OK', v_s || ' ' || v_s2);
  v_s := pg_temp.t_try(format('insert into analytics.rb_design (shop_id, design_no, name, stone_count, shape_id, stone_major_mm100, stone_minor_mm100, size_min, size_max, is_active) values (%L, 4091, %L, 5, %L, 200, 200, 45, 68, true)', v_shop, 'ตรง2-' || v_sfx, sh_round));
  perform pg_temp.chk('T11e (เขียนตรงแบบที่ active โดยไม่ผ่าน publish → ปฏิเสธ (CHECK active⇒published หรือ trigger draft_only))', v_s <> 'OK', v_s);

  -- --------------------------------------------------------------------
  -- T12 — X13 offer ซ้ำ + ต้องไม่พัง: ปิดแล้วเปิดใหม่ประวัติราคาต่อเนื่อง
  -- --------------------------------------------------------------------
  v_j := analytics.rb_offer_upsert(v_shop, v_actor, st_a, sh_oval, 300, 400);
  perform pg_temp.chk('T12a (X13: พิมพ์สลับ 3×4 ซ้ำ offer ไข่ 4×3 ที่มีอยู่ → แถวเดิม created=false)', (v_j ->> 'id')::uuid = of_a_oval and (v_j ->> 'created') = 'false', v_j::text);
  perform analytics.rb_set_active(v_shop, v_actor, 'offer', of_a_oval, false);
  v_j := analytics.rb_offer_upsert(v_shop, v_actor, st_a, sh_oval, 400, 300);
  v_cat := analytics.rb_public_catalog(v_shop);
  select count(*) into v_int from analytics.rb_offer_price where offer_id = of_a_oval;
  perform pg_temp.chk('T12b (ปิดแล้ว upsert key เดิม → เปิดแถวเดิม reactivated · ราคาเดิม 120 ยังอยู่ ไม่ต้องตั้งใหม่ · ประวัติ 1 แถว)',
    (v_j ->> 'id')::uuid = of_a_oval and (v_j ->> 'reactivated') = 'true' and pg_temp.cat_price(v_cat, n2, n_a) = 120 and v_int = 1, v_j::text);
  select count(*) into v_int from analytics.rb_stone_offer where stone_id = st_a and shape_id = sh_oval;
  perform pg_temp.chk('T12c (offer ของ A×ไข่ = แถวเดียวเสมอ)', v_int = 1);
  v_s := pg_temp.t_try(format('insert into analytics.rb_stone_offer (shop_id, stone_id, shape_id, major_mm100, minor_mm100) values (%L, %L, %L, 400, 300)', v_shop, st_a, sh_oval));
  perform pg_temp.chk('T12d (เขียนตรง offer ซ้ำ key → unique 23505)', v_s like '23505:%', v_s);

  -- --------------------------------------------------------------------
  -- T13 — X14 ล็อกหลัง publish (RPC + UPDATE ตรง) · แก้ชื่อ/ช่วงไซซ์/ลำดับยังได้ · ห้ามลบ
  -- --------------------------------------------------------------------
  v_s := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,%L,%L,6,%L,200,200,null,45,68,0)', v_shop, v_actor, d1, 'ทดสอบ-ก-' || v_sfx, sh_round));
  v_s2 := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,%L,%L,5,%L,200,200,null,45,68,0)', v_shop, v_actor, d1, 'ทดสอบ-ก-' || v_sfx, sh_drop));
  v_s3 := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,%L,%L,5,%L,250,250,null,45,68,0)', v_shop, v_actor, d1, 'ทดสอบ-ก-' || v_sfx, sh_round));
  v_s4 := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,%L,%L,7,%L,400,300,%L,53,68,0)', v_shop, v_actor, d2, 'ทดสอบ-ข-' || v_sfx, sh_oval, 'along_row'));
  perform pg_temp.chk('T13a (X14: หลัง publish แก้ stone_count / ทรง / ขนาดเม็ด / ทิศเม็ด ผ่าน RPC → design_locked)',
    v_s = '55000:design_locked' and v_s2 <> 'OK' and v_s3 = '55000:design_locked' and v_s4 = '55000:design_locked', v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4);
  v_s := pg_temp.t_try(format('update analytics.rb_design set stone_count = 6 where id = %L', d1));
  v_s2 := pg_temp.t_try(format('update analytics.rb_design set shape_id = %L where id = %L', sh_drop, d1));
  v_s3 := pg_temp.t_try(format('update analytics.rb_design set stone_major_mm100 = 250, stone_minor_mm100 = 250 where id = %L', d1));
  v_s4 := pg_temp.t_try(format('update analytics.rb_design set stone_axis = %L where id = %L', 'along_row', d2));
  v_s5 := pg_temp.t_try(format('update analytics.rb_design set design_no = 4001 where id = %L', d1));
  perform pg_temp.chk('T13b (X14: UPDATE ตรงโดยเจ้าของตาราง — จำนวนเม็ด/ทรง/ขนาด/ทิศ/เลขแบบ = 55000)',
    v_s = '55000:design_locked' and v_s2 = '55000:design_locked' and v_s3 = '55000:design_locked' and v_s4 = '55000:design_locked' and v_s5 = '55000:immutable', v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4 || ' ' || v_s5);
  v_s := pg_temp.t_try(format('update analytics.rb_design set published_at = null, is_active = false where id = %L', d1));
  v_s2 := pg_temp.t_try(format('update analytics.rb_design set published_at = now() where id = %L', d1));
  perform pg_temp.chk('T13c (published_at ตั้งแล้วล้าง/แก้ไม่ได้)', v_s = '55000:immutable' and v_s2 = '55000:immutable', v_s || ' ' || v_s2);
  v_s := pg_temp.t_try(format('select analytics.rb_shape_upsert(%L,%L,%L,%L,%L,0)', v_shop, v_actor, sh_oval, 'ไข่-x-' || v_sfx, 'round'));
  v_s2 := pg_temp.t_try(format('update analytics.rb_gem_shape set render_kind = %L where id = %L', 'round', sh_oval));
  perform pg_temp.chk('T13d (X14: แก้ render_kind ผ่าน RPC → shape_kind_locked · UPDATE ตรง → 55000)', v_s = '22023:shape_kind_locked' and v_s2 = '55000:shape_kind_locked', v_s || ' ' || v_s2);
  v_s := pg_temp.t_try(format('update analytics.rb_stone_offer set major_mm100 = 250, minor_mm100 = 250 where id = %L', of_a_round));
  v_s2 := pg_temp.t_try(format('update analytics.rb_stone_offer set stone_id = %L where id = %L', st_b, of_a_round));
  v_s3 := pg_temp.t_try(format('update analytics.rb_stone set stone_no = 900 where id = %L', st_a));
  perform pg_temp.chk('T13e (มิติ/พลอยของ offer และ stone_no แก้ไม่ได้)', v_s = '55000:immutable' and v_s2 = '55000:immutable' and v_s3 = '55000:immutable', v_s || ' ' || v_s2 || ' ' || v_s3);
  v_s := pg_temp.t_try(format('delete from analytics.rb_design where id = %L', d3));
  v_s2 := pg_temp.t_try(format('delete from analytics.rb_stone where id = %L', st_c));
  v_s3 := pg_temp.t_try(format('delete from analytics.rb_gem_shape where id = %L', sh_drop));
  v_s4 := pg_temp.t_try(format('delete from analytics.rb_stone_offer where id = %L', of_c_drop));
  perform pg_temp.chk('T13f (ห้ามลบแถวทุกตาราง (แม้ร่างที่ยังไม่ publish) — soft เท่านั้น)', v_s = '55000:no_delete' and v_s2 = '55000:no_delete' and v_s3 = '55000:no_delete' and v_s4 = '55000:no_delete', v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4);
  v_j := analytics.rb_design_upsert(v_shop, v_actor, d1, 'ทดสอบ-ก-ใหม่-' || v_sfx, 5, sh_round, 200, 200, null, 50, 66, 7);
  select d.name, d.size_min::int, d.size_max::int into v_txt, v_int, v_int2 from analytics.rb_design d where d.id = d1;
  perform pg_temp.chk('T13g (ต้องไม่พัง: หลัง publish แก้ชื่อ/ช่วงไซซ์/ลำดับได้ — ล็อกแค่ที่รหัสต้องพึ่ง)', v_txt like 'ทดสอบ-ก-ใหม่-%' and v_int = 50 and v_int2 = 66, v_txt);
  v_j := analytics.rb_design_upsert(v_shop, v_actor, d3, 'ทดสอบ-ร่าง-' || v_sfx, 4, sh_round, 250, 250, null, 45, 68, 0);
  select d.stone_count::int, d.stone_major_mm100::int into v_int, v_int2 from analytics.rb_design d where d.id = d3;
  perform pg_temp.chk('T13h (ร่างที่ยังไม่ publish แก้ได้ทุกอย่าง: 3→4 เม็ด · 2.00→2.50)', v_int = 4 and v_int2 = 250, v_int || '/' || v_int2);
  -- คืนช่วงไซซ์ d1 (ใช้ต่อ)
  perform analytics.rb_design_upsert(v_shop, v_actor, d1, 'ทดสอบ-ก-' || v_sfx, 5, sh_round, 200, 200, null, 45, 68, 0);

  -- --------------------------------------------------------------------
  -- T14 — X15 ชื่อซ้ำของแบบที่เปิดอยู่ (ในจำนวนเม็ดเดียวกัน · ไม่สนตัวพิมพ์)
  -- --------------------------------------------------------------------
  v_j := analytics.rb_design_upsert(v_shop, v_actor, null, upper('ทดสอบ-ก-' || v_sfx), 5, sh_round, 200, 200, null, 45, 68, 0);   -- ร่างชื่อซ้ำ (ตัวพิมพ์ต่างเฉพาะ latin) ได้
  v_s := pg_temp.t_try(format('select analytics.rb_design_price_set(%L,%L,%L,500)', v_shop, v_actor, (v_j ->> 'id')::uuid));
  v_s2 := pg_temp.t_try(format('select analytics.rb_design_publish(%L,%L,%L)', v_shop, v_actor, (v_j ->> 'id')::uuid));
  perform pg_temp.chk('T14a (X15: เปิดขายแบบที่ชื่อซ้ำ (ไม่สนตัวพิมพ์) ในจำนวนเม็ดเดียวกับแบบที่เปิดอยู่ → name_dup)', v_s = 'OK' and v_s2 = '22023:name_dup', v_s || ' ' || v_s2);
  v_j := analytics.rb_design_upsert(v_shop, v_actor, null, 'ทดสอบ-ก-' || v_sfx, 6, sh_round, 200, 200, null, 45, 68, 0);
  perform analytics.rb_design_price_set(v_shop, v_actor, (v_j ->> 'id')::uuid, 500);
  v_s := pg_temp.t_try(format('select analytics.rb_design_publish(%L,%L,%L)', v_shop, v_actor, (v_j ->> 'id')::uuid));
  perform pg_temp.chk('T14b (ชื่อเดียวกันแต่ต่างจำนวนเม็ด เปิดได้)', v_s = 'OK', v_s);
  perform pg_temp.chk('T14c (publish ซ้ำแบบที่เคย publish แล้ว = already ไม่ error)',
    (analytics.rb_design_publish(v_shop, v_actor, d1) ->> 'already') = 'true');
  v_j := analytics.rb_design_upsert(v_shop, v_actor, null, 'ไม่มีราคา-' || v_sfx, 5, sh_round, 200, 200, null, 45, 68, 0);
  v_s := pg_temp.t_try(format('select analytics.rb_design_publish(%L,%L,%L)', v_shop, v_actor, (v_j ->> 'id')::uuid));
  perform pg_temp.chk('T14d (เปิดขายโดยไม่มีราคาตัวเรือน → price_required)', v_s = '22023:price_required', v_s);
  perform analytics.rb_set_active(v_shop, v_actor, 'shape', sh_drop, false);
  v_j := analytics.rb_design_upsert(v_shop, v_actor, null, 'ทรงปิด-' || v_sfx, 5, sh_drop, 400, 300, 'along_row', 45, 68, 0);
  perform analytics.rb_design_price_set(v_shop, v_actor, (v_j ->> 'id')::uuid, 500);
  v_s := pg_temp.t_try(format('select analytics.rb_design_publish(%L,%L,%L)', v_shop, v_actor, (v_j ->> 'id')::uuid));
  perform pg_temp.chk('T14e (เปิดขายแบบที่ทรงปิดอยู่ → shape_inactive)', v_s = '22023:shape_inactive', v_s);
  perform analytics.rb_set_active(v_shop, v_actor, 'shape', sh_drop, true);
  v_s := pg_temp.t_try(format('select analytics.rb_set_active(%L,%L,%L,%L,true)', v_shop, v_actor, 'design', d3));
  v_j := analytics.rb_design_upsert(v_shop, v_actor, null, 'ร่าง2-' || v_sfx, 5, sh_round, 200, 200, null, 45, 68, 0);
  v_s2 := pg_temp.t_try(format('select analytics.rb_set_active(%L,%L,%L,%L,true)', v_shop, v_actor, 'design', (v_j ->> 'id')::uuid));
  perform pg_temp.chk('T14f (เปิดแบบที่ยังไม่เคย publish ด้วย set_active → not_published)', v_s2 = '22023:not_published', v_s2);

  -- --------------------------------------------------------------------
  -- T15 — X16/X5 ช่วงไซซ์ของแบบ
  -- --------------------------------------------------------------------
  v_s := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,null,%L,5,%L,200,200,null,44,68,0)', v_shop, v_actor, 'ช1-' || v_sfx, sh_round));
  v_s2 := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,null,%L,5,%L,200,200,null,45,69,0)', v_shop, v_actor, 'ช2-' || v_sfx, sh_round));
  v_s3 := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,null,%L,5,%L,200,200,null,60,55,0)', v_shop, v_actor, 'ช3-' || v_sfx, sh_round));
  v_s4 := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,null,%L,5,%L,200,200,null,null,68,0)', v_shop, v_actor, 'ช4-' || v_sfx, sh_round));
  v_s5 := pg_temp.t_try(format('insert into analytics.rb_design (shop_id, design_no, name, stone_count, shape_id, stone_major_mm100, stone_minor_mm100, size_min, size_max) values (%L, 4092, %L, 5, %L, 200, 200, 40, 68)', v_shop, 'ช5-' || v_sfx, sh_round));
  perform pg_temp.chk('T15a (ช่วงไซซ์ของแบบ: 44 · 69 · min>max · null · เขียนตรง 40 → ปฏิเสธ (22023 / CHECK 23514))',
    v_s = '22023:size_range_invalid' and v_s2 = '22023:size_range_invalid' and v_s3 = '22023:size_range_invalid' and v_s4 = '22023:size_range_invalid' and v_s5 like '23514:%',
    v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4 || ' ' || v_s5);

  -- --------------------------------------------------------------------
  -- T16 — X18 ฝั่ง DB: ขนาดพลอยนอก 0.50-20.00 มม. · ราคานอกช่วง · stone_count นอก 3-7
  -- --------------------------------------------------------------------
  v_s := pg_temp.t_try(format('select analytics.rb_offer_upsert(%L,%L,%L,%L,49,49)', v_shop, v_actor, st_a, sh_round));
  v_s2 := pg_temp.t_try(format('select analytics.rb_offer_upsert(%L,%L,%L,%L,2001,2001)', v_shop, v_actor, st_a, sh_round));
  v_s3 := pg_temp.t_try(format('select analytics.rb_offer_upsert(%L,%L,%L,%L,null,200)', v_shop, v_actor, st_a, sh_round));
  v_s4 := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,null,%L,5,%L,2500,2500,null,45,68,0)', v_shop, v_actor, 'ม1-' || v_sfx, sh_round));
  v_s5 := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,null,%L,2,%L,200,200,null,45,68,0)', v_shop, v_actor, 'ม2-' || v_sfx, sh_round));
  perform pg_temp.chk('T16a (ขนาดพลอย 49 · 2001 · null · 25 มม. · จำนวนเม็ด 2 → 22023)',
    v_s = '22023:size_invalid' and v_s2 = '22023:size_invalid' and v_s3 = '22023:size_invalid' and v_s4 = '22023:size_invalid' and v_s5 = '22023:stone_count_invalid', v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4 || ' ' || v_s5);
  v_s := pg_temp.t_try(format('select analytics.rb_offer_price_set(%L,%L,%L,0)', v_shop, v_actor, of_a_round));
  v_s2 := pg_temp.t_try(format('select analytics.rb_offer_price_set(%L,%L,%L,-5)', v_shop, v_actor, of_a_round));
  v_s3 := pg_temp.t_try(format('select analytics.rb_offer_price_set(%L,%L,%L,100001)', v_shop, v_actor, of_a_round));
  v_s4 := pg_temp.t_try(format('select analytics.rb_design_price_set(%L,%L,%L,0)', v_shop, v_actor, d1));
  v_s5 := pg_temp.t_try(format('select analytics.rb_design_price_set(%L,%L,%L,1000001)', v_shop, v_actor, d1));
  perform pg_temp.chk('T16b (ราคา 0 · ติดลบ · เกินเพดาน (พลอย 100,000 · เรือน 1,000,000) → price_invalid · ไม่มีแถวราคา 0 เกิดขึ้น)',
    v_s = '22023:price_invalid' and v_s2 = '22023:price_invalid' and v_s3 = '22023:price_invalid' and v_s4 = '22023:price_invalid' and v_s5 = '22023:price_invalid', v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4 || ' ' || v_s5);
  select count(*) into v_int from analytics.rb_offer_price where price_thb <= 0;
  perform pg_temp.chk('T16c (ไม่มีแถวราคาพลอย <= 0 ในตาราง)', v_int = 0, 'n=' || v_int);
  v_s := pg_temp.t_try(format('insert into analytics.rb_offer_price (offer_id, effective_from, price_thb) values (%L, now() + interval ''1 day'', 0)', of_a_round));
  perform pg_temp.chk('T16d (เขียนตรงราคา 0 → CHECK 23514)', v_s like '23514:%', v_s);

  -- --------------------------------------------------------------------
  -- T17 — X19 (ส่วนที่ครอบ): แก้ stone_count ขณะมี model ผูกอยู่ · model ต้องเป็น object
  -- --------------------------------------------------------------------
  v_j := analytics.rb_design_upsert(v_shop, v_actor, null, 'โมเดล-' || v_sfx, 5, sh_round, 200, 200, null, 45, 68, 0);
  update analytics.rb_design set model = '{"kind":"glb"}'::jsonb where id = (v_j ->> 'id')::uuid;   -- P2 ยังไม่มี RPC ตั้ง model — เขียนตรงในทรานแซกชันนี้เพื่อพิสูจน์ด่าน
  v_s := pg_temp.t_try(format('select analytics.rb_design_upsert(%L,%L,%L,%L,6,%L,200,200,null,45,68,0)', v_shop, v_actor, (v_j ->> 'id')::uuid, 'โมเดล-' || v_sfx, sh_round));
  v_s2 := pg_temp.t_try(format('update analytics.rb_design set model = %L::jsonb where id = %L', '[1]', (v_j ->> 'id')::uuid));
  perform pg_temp.chk('T17a (X19: แก้จำนวนเม็ดขณะมี model → 55000 model_bound · model ที่ไม่ใช่ object → CHECK 23514)', v_s = '55000:model_bound' and v_s2 like '23514:%', v_s || ' ' || v_s2);
  perform pg_temp.skip('T17b (X19: ตัวตรวจไฟล์ GLB — gem_1..N · 1 MB · extensionsRequired · bbox)', 'P2 ยังไม่ทำ — ไม่อยู่ในขอบเขตงานนี้');

  -- --------------------------------------------------------------------
  -- T18 — X20 ร่าง/ปิดแล้ว/ร้านอื่นไม่หลุดถึงสาธารณะ · แบบที่ไม่มีรูปการ์ดใช้งานครบ
  -- --------------------------------------------------------------------
  v_cat := analytics.rb_public_catalog(v_shop);
  v_q := pg_temp.q(n3, 54, array[0, 0, 0, 0]);
  perform pg_temp.chk('T18a (X20: ร่าง (ยังไม่ publish) ไม่อยู่ใน catalog · quote = design_unavailable)', pg_temp.cat_design(v_cat, n3) is null and v_q ->> 'code' = 'design_unavailable', v_q::text);
  perform analytics.rb_set_active(v_shop, v_actor, 'design', d2, false);
  v_cat := analytics.rb_public_catalog(v_shop);
  v_q := pg_temp.q(n2, 60, array[0, 0, 0, 0, 0, 0, 0]);
  perform pg_temp.chk('T18b (แบบที่ปิดแล้วไม่อยู่ใน catalog · quote design_unavailable)', pg_temp.cat_design(v_cat, n2) is null and v_q ->> 'code' = 'design_unavailable', v_q::text);
  v_cc := pg_temp.cc(n2, 60, array[n_a, n_a, 0, 0, 0, 0, 0], v_t0, 740);
  perform pg_temp.chk('T18c (ต้องไม่พัง: แบบปิดแล้ว code_check ยังคิดราคา ณ ตอนสร้างได้ · แจ้ง is_active=false + เวลาปิด)',
    (v_cc ->> 'found') = 'true' and (v_cc -> 'design' ->> 'is_active') = 'false' and (v_cc -> 'design' ->> 'status_changed_at') is not null and (v_cc -> 'creation' ->> 'total') = '740', v_cc::text);
  perform analytics.rb_set_active(v_shop, v_actor, 'design', d2, true);
  perform pg_temp.chk('T18d (เปิดแบบที่เคย publish กลับได้)', pg_temp.cat_design(analytics.rb_public_catalog(v_shop), n2) is not null);
  v_cat := analytics.rb_public_catalog(gen_random_uuid());
  perform pg_temp.chk('T18e (ร้านอื่น: catalog ว่างทั้งแบบและพลอย)', jsonb_array_length(v_cat -> 'designs') = 0 and jsonb_array_length(v_cat -> 'stones') = 0);
  perform pg_temp.chk('T18f (แบบที่ไม่มีรูปการ์ด (card_image_path null) อยู่ใน catalog และออกราคาได้)',
    (pg_temp.cat_design(analytics.rb_public_catalog(v_shop), n1) -> 'card_image_path') = 'null'::jsonb and (pg_temp.q(n1, null, array[0, 0, 0, 0, 0]) ->> 'ok') = 'true');
  v_s := pg_temp.t_try(format('select analytics.rb_design_card_set(%L,%L,%L,%L)', v_shop, v_actor, d1, 'designs/../x.jpg'));
  v_s2 := pg_temp.t_try(format('select analytics.rb_design_card_set(%L,%L,%L,%L)', v_shop, v_actor, d1, 'x/' || gen_random_uuid()::text || '.jpg'));
  v_txt := 'designs/' || gen_random_uuid()::text || '.jpg';
  v_j := analytics.rb_design_card_set(v_shop, v_actor, d1, v_txt);
  v_s3 := pg_temp.t_try(format('select analytics.rb_design_card_set(%L,%L,%L,%L)', v_shop, v_actor, d4, v_txt));
  perform pg_temp.chk('T18g (path รูปการ์ด: traversal/นอก designs/ ปฏิเสธ · path ซ้ำข้ามแบบปฏิเสธ · ตั้ง/ล้างได้ คืน previous_path)',
    v_s = '22023:path_invalid' and v_s2 = '22023:path_invalid' and v_s3 = '22023:path_invalid' and (v_j -> 'previous_path') = 'null'::jsonb
    and (analytics.rb_design_card_set(v_shop, v_actor, d1, null) ->> 'previous_path') = v_txt, v_s || ' ' || v_s2 || ' ' || v_s3);

  -- --------------------------------------------------------------------
  -- T19 — สิทธิ์หลังบ้าน: actor ปลอม/ไม่ใช่ owner-admin · ไม่มี p_actor ทุก RPC (X2 ส่วน DB)
  -- --------------------------------------------------------------------
  v_s := 'ok';
  foreach v_txt in array array[
    format('select analytics.rb_shape_upsert(%L,%%L,null,%L,%L,0)', v_shop, 'สิทธิ์-' || v_sfx, 'round'),
    format('select analytics.rb_stone_upsert(%L,%%L,null,%L,%L,%L,0)', v_shop, 'สิทธิ์-' || v_sfx, 'สิทธิ์', '#112233'),
    format('select analytics.rb_offer_upsert(%L,%%L,%L,%L,200,200)', v_shop, st_a, sh_round),
    format('select analytics.rb_offer_price_set(%L,%%L,%L,99)', v_shop, of_a_round),
    format('select analytics.rb_design_upsert(%L,%%L,null,%L,5,%L,200,200,null,45,68,0)', v_shop, 'สิทธิ์-' || v_sfx, sh_round),
    format('select analytics.rb_design_price_set(%L,%%L,%L,99)', v_shop, d1),
    format('select analytics.rb_design_card_set(%L,%%L,%L,null)', v_shop, d1),
    format('select analytics.rb_design_publish(%L,%%L,%L)', v_shop, d3),
    format('select analytics.rb_design_duplicate(%L,%%L,%L)', v_shop, d1),
    format('select analytics.rb_set_active(%L,%%L,%L,%L,false)', v_shop, 'stone', st_b),
    format('select analytics.rb_admin_catalog(%L,%%L)', v_shop),
    format('select analytics.rb_code_check(%L,%%L,%s,54,array[0,0,0,0,0],now(),480)', v_shop, n1)] loop
    -- actor ที่ไม่ใช่สมาชิกเลย → 42501 rb_actor_forbidden · actor null → 22023 actor_required
    if pg_temp.t_try(format(v_txt, gen_random_uuid()::text)) <> '42501:rb_actor_forbidden' then
      v_s := v_s || ' forbidden-miss: ' || left(v_txt, 45) || '=>' || pg_temp.t_try(format(v_txt, gen_random_uuid()::text));
    end if;
    if pg_temp.t_try(format(v_txt, null::text)) <> '22023:actor_required' then
      v_s := v_s || ' null-miss: ' || left(v_txt, 45) || '=>' || pg_temp.t_try(format(v_txt, null::text));
    end if;
  end loop;
  perform pg_temp.chk('T19a (RPC หลังบ้าน 12 ตัว: actor ที่ไม่ใช่สมาชิก → 42501 · actor null → 22023 · ไม่มีตัวไหนข้าม)', v_s = 'ok', v_s);
  if v_staff is not null then
    perform pg_temp.chk('T19b (actor เป็นสมาชิก staff → 42501 ทุก RPC หลังบ้าน)',
      pg_temp.t_try(format('select analytics.rb_admin_catalog(%L,%L)', v_shop, v_staff)) = '42501:rb_actor_forbidden'
      and pg_temp.t_try(format('select analytics.rb_offer_price_set(%L,%L,%L,99)', v_shop, v_staff, of_a_round)) = '42501:rb_actor_forbidden');
  else
    perform pg_temp.skip('T19b (actor staff)', 'ไม่มีสมาชิก staff ในร้านนี้ให้ทดสอบ');
  end if;
  -- ผู้เรียกที่ไม่ใช่ service_role และไม่ใช่สมาชิก (authenticated ไร้ uid) → crm_require_owner_admin ปฏิเสธก่อน
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  v_s := pg_temp.t_try(format('select analytics.rb_admin_catalog(%L,%L)', v_shop, v_actor));
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform pg_temp.chk('T19c (ผู้เรียก authenticated ที่ไม่ใช่สมาชิกร้าน → 42501 จาก crm_require_owner_admin)', v_s like '42501:%', v_s);
  v_s := pg_temp.t_try(format('select analytics.rb_set_active(%L,%L,%L,%L,false)', v_shop, v_actor, 'bogus', st_b));
  v_s2 := pg_temp.t_try(format('select analytics.rb_set_active(%L,%L,%L,%L,null)', v_shop, v_actor, 'stone', st_b));
  v_s3 := pg_temp.t_try(format('select analytics.rb_set_active(%L,%L,%L,%L,false)', v_shop, v_actor, 'stone', gen_random_uuid()));
  perform pg_temp.chk('T19d (rb_set_active: kind แปลก/active null → invalid · id ที่ไม่มี → not_found)', v_s = '22023:invalid' and v_s2 = '22023:invalid' and v_s3 = '22023:not_found', v_s || ' ' || v_s2 || ' ' || v_s3);

  -- --------------------------------------------------------------------
  -- T20 — rb_code_check: ครบสถานะ · ไซซ์ null วนครบรอบ quote → code_check
  -- --------------------------------------------------------------------
  v_q := pg_temp.q(n2, null, array[n_a, 0, n_a, 0, 0, 0, 0]);
  v_cc := pg_temp.cc(n2, null, array[n_a, 0, n_a, 0, 0, 0, 0], (v_q ->> 'priced_at')::timestamptz, (v_q ->> 'total')::int);
  perform pg_temp.chk('T20a (ไซซ์ null: quote → code_check วนครบ · size_status = admin_check · signed_total_match · ราคาตอนสร้าง = ปัจจุบัน)',
    (v_cc ->> 'size_status') = 'admin_check' and (v_cc ->> 'signed_total_match') = 'true' and (v_cc -> 'creation' ->> 'total') = (v_cc -> 'current' ->> 'total'), v_cc::text);
  v_cc := pg_temp.cc(n2, 60, array[0, 0, 0, 0, 0, 0, 0], v_t0, 500);
  v_s := v_cc ->> 'size_status';
  v_cc := pg_temp.cc(n2, 50, array[0, 0, 0, 0, 0, 0, 0], v_t0, 500);
  perform pg_temp.chk('T20b (size_status: ในช่วงแบบ = ok · นอกช่วงแบบแต่ในช่วงร้าน = out_of_range)', v_s = 'ok' and (v_cc ->> 'size_status') = 'out_of_range', v_s || ' ' || (v_cc ->> 'size_status'));
  perform analytics.rb_set_active(v_shop, v_actor, 'stone', st_b, false);
  v_cc := pg_temp.cc(n1, 54, array[n_a, 0, n_b, 0, n_a], v_t, 720);
  perform pg_temp.chk('T20c (พลอยที่ปิดไปแล้ว: ยังคิดราคาย้อนได้ · closed_stones ระบุ B · บรรทัดปัจจุบัน stone_active=false)',
    (v_cc -> 'creation' ->> 'total') = '720' and (v_cc -> 'closed_stones') = jsonb_build_array(jsonb_build_object('stone_no', n_b, 'name', 'ซิทริน-' || v_sfx))
    and (v_cc -> 'current' -> 'lines' -> 2 ->> 'stone_active') = 'false', v_cc::text);
  perform analytics.rb_set_active(v_shop, v_actor, 'stone', st_b, true);
  v_s := pg_temp.t_try(format('select analytics.rb_code_check(%L,%L,%s,54,array[0,0],now(),480)', v_shop, v_actor, n1));
  v_s2 := pg_temp.t_try(format('select analytics.rb_code_check(%L,%L,%s,54,array[0,0,0,0,0],null,480)', v_shop, v_actor, n1));
  v_s3 := pg_temp.t_try(format('select analytics.rb_code_check(%L,%L,%s,54,array[0,0,0,0,0],now(),262144)', v_shop, v_actor, n1));
  v_s4 := pg_temp.t_try(format('select analytics.rb_code_check(%L,%L,%s,44,array[0,0,0,0,0],now(),480)', v_shop, v_actor, n1));
  perform pg_temp.chk('T20d (code_check input ผิด: n ไม่ตรง → count_mismatch · priced_at null / total 262144 / ไซซ์ 44 → invalid)',
    v_s = '22023:count_mismatch' and v_s2 = '22023:invalid' and v_s3 = '22023:invalid' and v_s4 = '22023:invalid', v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4);
  v_cc := pg_temp.cc(4000, 54, array[0, 0, 0, 0, 0], v_t, 480);
  v_cc := coalesce(v_cc, '{}'::jsonb);
  perform pg_temp.chk('T20e (เลขแบบที่ไม่มีในระบบ (HMAC ถูกแต่ DB ไม่รู้จัก) → found=false ไม่ใช่ error)', (v_cc ->> 'found') = 'false', v_cc::text);
  v_cc := pg_temp.cc(n3, 54, array[0, 0, 0, 0], v_t, 300);
  perform pg_temp.chk('T20f (แบบร่างที่ยังไม่เคย publish → found=false (ไม่เปิดเผยร่าง))', (v_cc ->> 'found') = 'false', v_cc::text);

  -- --------------------------------------------------------------------
  -- T21 — rb_admin_catalog: coverage "ขายได้ x/y แบบ · ขาดเพราะ…"
  -- --------------------------------------------------------------------
  v_adm := analytics.rb_admin_catalog(v_shop, v_actor);
  perform pg_temp.chk('T21a (key ระดับบนของ admin catalog)', pg_temp.keys(v_adm) = 'catalog_at,designs,shapes,sizes,stones', pg_temp.keys(v_adm));
  select e into v_j from jsonb_array_elements(v_adm -> 'stones') e where (e ->> 'stone_no')::int = n_b;
  select count(*) into v_int from jsonb_array_elements(v_j -> 'coverage' -> 'missing') m where m ->> 'reason' = 'no_offer' and (m ->> 'design_no')::int = n2;
  select count(*) into v_int2 from jsonb_array_elements(v_j -> 'coverage' -> 'missing') m where m ->> 'reason' = 'no_price' and (m ->> 'design_no')::int = n4;
  perform pg_temp.chk('T21b (พลอย B: ไม่มีราคาทรงไข่ → no_offer ที่แบบไข่ · มี offer 3×3 แต่ไม่มีราคา → no_price ที่แบบ 3×3 · x < y)',
    v_int = 1 and v_int2 = 1 and (v_j -> 'coverage' ->> 'sellable_designs')::int < (v_j -> 'coverage' ->> 'visible_designs')::int, (v_j -> 'coverage')::text);
  select e into v_j from jsonb_array_elements(v_adm -> 'stones') e where (e ->> 'stone_no')::int = n_a;
  perform pg_temp.chk('T21c (พลอย A: ขายได้ในแบบกลม 5 เม็ด + ไข่ · ขาดในแบบ 3×3 และแบบ 3 เม็ด/6 เม็ด/D6 ตามเหตุผล no_offer)',
    (v_j -> 'coverage' ->> 'sellable_designs')::int >= 2
    and exists (select 1 from jsonb_array_elements(v_j -> 'coverage' -> 'missing') m where (m ->> 'design_no')::int = n4 and m ->> 'reason' = 'no_offer'), (v_j -> 'coverage')::text);
  select e into v_j from jsonb_array_elements(v_adm -> 'designs') e where (e ->> 'design_no')::int = n3;
  perform pg_temp.chk('T21d (แบบร่าง: published=false · visible=false · hidden_reason=draft · locked=false)',
    (v_j ->> 'published') = 'false' and (v_j ->> 'visible') = 'false' and (v_j ->> 'hidden_reason') = 'draft' and (v_j ->> 'locked') = 'false', v_j::text);
  select e into v_j from jsonb_array_elements(v_adm -> 'designs') e where (e ->> 'design_no')::int = n1;
  perform pg_temp.chk('T21e (แบบ d1: visible · locked · sellable_stones = A และ B (2 ชนิด) · key ของแบบครบ)',
    (v_j ->> 'visible') = 'true' and (v_j ->> 'locked') = 'true' and (v_j ->> 'sellable_stones') = '2' and (v_j ->> 'body_price_thb') in ('500', '510')
    and (v_j ->> 'status_changed_at') is not null, v_j::text);
  select e into v_j from jsonb_array_elements(v_adm -> 'shapes') e where e ->> 'id' = sh_round::text;
  perform pg_temp.chk('T21f (ทรง: used_by_active_designs นับแบบที่เปิดอยู่ · ใช้เตือนก่อนปิด)', (v_j ->> 'used_by_active_designs')::int >= 3 and (v_j ->> 'used_by_designs')::int >= (v_j ->> 'used_by_active_designs')::int, v_j::text);
  v_s := pg_temp.t_try(format('select analytics.rb_design_duplicate(%L,%L,%L)', v_shop, v_actor, d1));
  v_j := analytics.rb_design_duplicate(v_shop, v_actor, d1);
  select d.published_at is null and not d.is_active and d.card_image_path is null and d.model is null, d.design_no::int into v_bool, v_int from analytics.rb_design d where d.id = (v_j ->> 'id')::uuid;
  select count(*) into v_int2 from analytics.rb_design_price where design_id = (v_j ->> 'id')::uuid;
  perform pg_temp.chk('T21g (ทำสำเนา: ได้ design_no ใหม่ · เป็นร่าง · ไม่คัดลอกรูป/model · คัดลอกราคาตัวเรือน 1 แถว)', v_s = 'OK' and v_bool and v_int > n6 and v_int2 = 1, v_j::text);
  select count(distinct design_no) = count(*) into v_bool from analytics.rb_design where shop_id = v_shop;
  perform pg_temp.chk('T21h (design_no ไม่ซ้ำ/ไม่ถูกใช้ซ้ำ)', v_bool);

  -- --------------------------------------------------------------------
  -- T22 — เลขพลอย/ข้อความ/ต้องไม่พัง: เพิ่มแบบ 4 เม็ดแล้วขึ้นเองโดยไม่ต้องแก้โค้ด
  -- --------------------------------------------------------------------
  select s.stone_no::int into v_int from analytics.rb_stone s where s.id = st_c;
  perform pg_temp.chk('T22a (เลขพลอยเพิ่มทีละ 1 ไม่ใช้ซ้ำ)', n_b = n_a + 1 and n_c = n_b + 1 and v_int = n_c);
  v_j := analytics.rb_design_upsert(v_shop, v_actor, null, 'ใหม่4-' || v_sfx, 4, sh_round, 200, 200, null, 50, 68, 0);
  perform analytics.rb_design_price_set(v_shop, v_actor, (v_j ->> 'id')::uuid, 700);
  perform analytics.rb_design_publish(v_shop, v_actor, (v_j ->> 'id')::uuid);
  perform pg_sleep(1.2);
  v_cat := analytics.rb_public_catalog(v_shop);
  perform pg_temp.chk('T22b (ต้องไม่พัง: เพิ่มแบบ 4 เม็ด → ขึ้นใน catalog เองจาก DB ทันทีที่ราคามีผล พร้อมพลอยกลม 2×2 ที่ขายได้)',
    pg_temp.cat_design(v_cat, (v_j ->> 'design_no')::int) is not null and pg_temp.cat_price(v_cat, (v_j ->> 'design_no')::int, n_a) = 100);
  v_s := pg_temp.t_try(format('select analytics.rb_shape_upsert(%L,%L,null,%L,%L,0)', v_shop, v_actor, 'กลม2-' || v_sfx, 'round'));
  v_s2 := pg_temp.t_try(format('select analytics.rb_stone_upsert(%L,%L,null,%L,%L,%L,0)', v_shop, v_actor, upper('โกเมน-' || v_sfx), 'x', '#112233'));
  perform pg_temp.chk('T22c (ชื่อทรง/ชื่อพลอยซ้ำ (ไม่สนตัวพิมพ์) → name_dup)', v_s = '22023:name_dup' and v_s2 = '22023:name_dup', v_s || ' ' || v_s2);
  v_s := pg_temp.t_try(format('select analytics.rb_stone_upsert(%L,%L,null,%L,%L,%L,0)', v_shop, v_actor, 'ปกติ-' || v_sfx, 'ยาวเกินหกตัว', '#112233'));
  v_s2 := pg_temp.t_try(format('select analytics.rb_stone_upsert(%L,%L,null,%L,%L,%L,0)', v_shop, v_actor, 'ปกติ2-' || v_sfx, 'สั้น', 'FFF000'));
  v_s3 := pg_temp.t_try(format('select analytics.rb_stone_upsert(%L,%L,null,%L,%L,%L,0)', v_shop, v_actor, 'ปกติ3-' || v_sfx, 'สั้น', '#12345'));
  v_s4 := pg_temp.t_try(format('select analytics.rb_stone_upsert(%L,%L,null,%L,%L,%L,0)', v_shop, v_actor, 'ปกติ4-' || v_sfx, 'สั้น', null));
  perform pg_temp.chk('T22d (ชื่อสั้น > 6 ตัว · สีไม่ใช่ #RRGGBB · สี null → 22023)', v_s = '22023:short_name_invalid' and v_s2 = '22023:color_invalid' and v_s3 = '22023:color_invalid' and v_s4 = '22023:color_invalid', v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4);
  select s.color_hex into v_txt from analytics.rb_stone s where s.id = st_b;
  perform pg_temp.chk('T22e (สี #e3a82b ที่พิมพ์ตัวเล็ก → เก็บเป็นตัวใหญ่ #E3A82B)', v_txt = '#E3A82B', v_txt);
  v_s := pg_temp.t_try(format('select analytics.rb_stone_upsert(%L,%L,null,%L,%L,%L,0)', v_shop, v_actor, 'ล่องหน' || chr(8203) || v_sfx, 'ล1', '#112233'));
  v_s2 := pg_temp.t_try(format('select analytics.rb_stone_upsert(%L,%L,null,%L,%L,%L,0)', v_shop, v_actor, '...', 'ล2', '#112233'));
  v_s3 := pg_temp.t_try(format('select analytics.rb_stone_upsert(%L,%L,null,%L,%L,%L,0)', v_shop, v_actor, 'ตัวควบคุม' || chr(9) || v_sfx, 'ล3', '#112233'));
  v_s4 := pg_temp.t_try(format('select analytics.rb_stone_upsert(%L,%L,null,%L,%L,%L,0)', v_shop, v_actor, repeat('ก', 41), 'ล4', '#112233'));
  v_s5 := pg_temp.t_try(format('select analytics.rb_stone_upsert(%L,%L,null,%L,%L,%L,0)', v_shop, v_actor, '', 'ล5', '#112233'));
  perform pg_temp.chk('T22f (ชื่อพลอย: อักขระล่องหน (ZWSP) · มีแต่เครื่องหมาย · control (tab) · 41 ตัว · ว่าง → name_invalid)',
    v_s = '22023:name_invalid' and v_s2 = '22023:name_invalid' and v_s3 = '22023:name_invalid' and v_s4 = '22023:name_invalid' and v_s5 = '22023:name_invalid', v_s || ' ' || v_s2 || ' ' || v_s3 || ' ' || v_s4 || ' ' || v_s5);

  -- --------------------------------------------------------------------
  -- T23 — total_too_large (เพดาน 18 บิตของรหัส) · เส้นแบ่งเป๊ะ
  -- --------------------------------------------------------------------
  v_q := pg_temp.q(n6, 54, array[0, 0, 0]);
  v_q2 := pg_temp.q(n6, 54, array[n_a, 0, 0]);
  perform pg_temp.chk('T23a (ราคารวม = 262,143 พอดี ผ่าน · 262,143 + พลอย → total_too_large)', (v_q ->> 'total') = '262143' and v_q2 ->> 'code' = 'total_too_large', v_q::text || ' ' || v_q2::text);

  -- --------------------------------------------------------------------
  -- T24 — parity ช่วงไซซ์ DB ⇔ ของเดิม · bucket
  -- --------------------------------------------------------------------
  perform pg_temp.chk('T24a (analytics.rb_size_range() = [45,68] และตรงกับ ring_size_shop_range() ของ 0193)',
    lower(analytics.rb_size_range()) = 45 and upper(analytics.rb_size_range()) - 1 = 68
    and (to_regprocedure('analytics.ring_size_shop_range()') is null or analytics.ring_size_shop_range() = analytics.rb_size_range()));
  perform pg_temp.chk('T24b (bucket ring-builder: public · 1 MB · image/jpeg · ไม่มี storage policy อ้างถึง)',
    exists (select 1 from storage.buckets b where b.id = 'ring-builder' and b.public and b.file_size_limit = 1048576 and b.allowed_mime_types = array['image/jpeg'])
    and not exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename in ('objects', 'buckets') and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%ring-builder%'));

  -- --------------------------------------------------------------------
  -- T25 — หลังทดสอบทั้งหมด: ACL ยังสะอาด · ไม่มี overload (ไม่มีอะไรถูก create or replace ลบสิทธิ์)
  -- --------------------------------------------------------------------
  perform pg_temp.chk('T25a (ปลายทาง: ไม่มี EXECUTE รั่วให้ PUBLIC/anon/authenticated บนฟังก์ชันใดในสคีมา)', pg_temp.fn_leaks() = 0, 'leaks=' || pg_temp.fn_leaks());
  select count(*) into v_int from (select proname from pg_proc where pronamespace = 'analytics'::regnamespace and proname like 'rb\_%' group by proname having count(*) > 1) d;
  perform pg_temp.chk('T25b (ปลายทาง: ไม่มี overload)', v_int = 0);

  -- --------------------------------------------------------------------
  select count(*) filter (where ok is true), count(*) filter (where ok is null), count(*) filter (where ok is false)
    into v_pass, v_skip, v_fail from _vr;
  select string_agg(format('%s: %s%s', name,
                           case when ok is null then 'SKIP' when ok then 'PASS' else 'FAIL' end,
                           case when ok is true then '' else ' — ' || coalesce(detail, '') end), E'\n' order by n)
    into v_log from _vr;
  raise exception E'\n=== verify-0196 (ring_builder) ===\n%\n--- PASS=% SKIP=% FAIL=% (ทั้งก้อน rollback แล้ว — DB ไม่ขยับ) ---', v_log, v_pass, v_skip, v_fail;
end;
$verify0196$;
