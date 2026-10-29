-- scripts/verify/verify-0193-qa.sql
-- QA อิสระรอบที่ 2 ของ 0193_ring_size_analytics.sql (เสริม verify-0193.sql ของ dev — ไม่แทนที่)
-- do-block + raise exception บังคับ rollback เสมอ (3j-migration-traps #11) · ข้อมูลทดสอบสร้างผ่าน RPC
-- (ring_size_session_upsert) เท่านั้น · ตัวเลขคาดหวังทุกตัวคิดมือล่วงหน้าจาก fixture (ไม่ใช้สูตรเดียวกับโค้ด)
--
-- วิธีรัน (ซ้อมก่อน apply — migration + ไฟล์นี้รวมไฟล์เดียว ขึ้นต้น set local lock_timeout = '8s'):
--   cat supabase/migrations/0193_ring_size_analytics.sql scripts/verify/verify-0193-qa.sql > <ไฟล์รวม>
--   node scripts/run-sql.mjs <ไฟล์รวม>            (ห้ามใส่ --commit / --record)
-- อ่านผลเหมือน verify-0193: บรรทัดท้าย "PASS=n SKIP=n FAIL=n" · SKIP = เคสที่ไม่มีข้อมูลจริงให้ทดสอบ (ไม่นับเป็นผ่าน)
--
-- สิ่งที่ไฟล์นี้เพิ่มจาก verify-0193 (ตารางแมป):
--  QA1  fixture 5 session คิดมือ (ผสมวิธี/ผล/เลิกกลางทาง/G4/สลับวิธี) → funnel · abandon_at · method_stats · switched · result_sizes · size_summary · daily ตรงมือ
--  QA2  วันไทย ขอบระดับไมโครวินาที (23:59:59.999999 / 00:00:00) ทั้งขอบต้นและขอบท้าย + นับตาม created_at ไม่ใช่ updated_at · mutant UTC
--  QA3  upsert ลำดับสลับ (stage 7 มาก่อน stage 2/5/6/1/0) ไม่ถอย · method = ล่าสุดที่ "มาถึง" (characterization)
--  QA4  sid เดิมครั้งที่ 41 → P0001 และแถวไม่ขยับแม้ payload เต็ม
--  QA5  retention ขอบละเอียด (พอดี 180 วัน อยู่ · เกิน 1 ไมโครวินาที หาย · 179 ชม.59น. อยู่ · นับ created_at) · mutant `<=`
--  QA6  จำนวนมาก 1,500 session ช่วงเพดาน 180 วัน → invariant + ตัวเลขคิดมือ + เวลา
--  QA7  stats วันที่สุดขอบ (infinity / ปีไกล) · QA8 characterization: event ผลที่ไม่มี size ล้าง result_size
--  QA9  JSON แปลก (ไทย/emoji/fullwidth/key ซ้ำ/เลขวิทยาศาสตร์/ล้น) ผ่าน RPC โดยตรง
--  QA10 stats shape ล็อก 20 key + ไม่มี uuid/เวลาระดับนาทีหลุดในผล (PDPA)
--  QA13 staff จริง (สลับ role ของ owner เดิมในทรานแซกชัน) → stats 42501 (แทน T13c ที่ SKIP)
--  QA14 breaker: ขอบหน้าต่าง 10 นาที (9 นาทีนับ · พอดี 10 นาทีไม่นับ) · mutant หน้าต่าง
--  ช่องว่างที่ SQL จำลองไม่ได้: race 2 connection พร้อมกัน (ดู verify-0193 หัวไฟล์) — ไม่มีเทสต์ครอบ

-- ok: true = PASS · false = FAIL · null = SKIP
create temp table _vr (
  n      serial,
  name   text not null,
  ok     boolean,
  detail text
) on commit drop;

create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default '') returns void
language plpgsql as $f$
begin
  insert into _vr (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  raise notice '[live] % = %', p_name,
    case when coalesce(p_ok, false) then 'PASS' else 'FAIL / ' || coalesce(p_detail, '') end;
end
$f$;

create function pg_temp.up(p_shop uuid, p_sid uuid, p_snap text) returns text
language plpgsql as $f$
begin
  perform analytics.ring_size_session_upsert(p_shop, p_sid, p_snap::jsonb);
  return 'OK';
exception when others then
  return sqlstate;
end
$f$;

create function pg_temp.st(p_shop uuid, p_from date, p_to date) returns text
language plpgsql as $f$
begin
  perform analytics.ring_size_stats(p_shop, p_from, p_to);
  return 'OK';
exception when others then
  return sqlstate;
end
$f$;

-- fixture: สร้างผ่าน RPC แล้วย้าย created_at (เจ้าของตารางทำได้ — ตารางไม่มี trigger)
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

-- ส่งหลาย snapshot เข้า sid เดียวตามลำดับ · คืน 'OK' หรือ state แรกที่ไม่ใช่ OK
create function pg_temp.seq(p_shop uuid, p_sid uuid, p_snaps text[]) returns text
language plpgsql as $f$
declare
  v_s text;
  v_r text;
begin
  foreach v_s in array p_snaps loop
    v_r := pg_temp.up(p_shop, p_sid, v_s);
    if v_r <> 'OK' then return v_r || ' @ ' || v_s; end if;
  end loop;
  return 'OK';
end
$f$;

-- invariant 6 ข้อของ stats (เหมือน verify-0193 pg_temp.inv — เขียนซ้ำโดยตั้งใจเพื่อให้ไฟล์นี้ไม่พึ่งไฟล์อื่น)
create function pg_temp.inv(s jsonb) returns boolean
language sql as $f$
select (select coalesce(sum(x::int), 0) from jsonb_array_elements_text(s -> 'abandon_at') x) + (s -> 'funnel' ->> 7)::int = (s ->> 'sessions')::int
   and (s -> 'funnel' ->> 0)::int = (s ->> 'sessions')::int
   and (select coalesce(sum(x.value::int), 0) from jsonb_each_text(s -> 'by_in_app') x) = (s ->> 'sessions')::int
   and (select coalesce(sum((e ->> 'sessions')::int), 0) from jsonb_array_elements(s -> 'daily') e) = (s ->> 'sessions')::int
   and (select bool_and((s -> 'funnel' ->> (k + 1))::int <= (s -> 'funnel' ->> k)::int) from generate_series(0, 6) k)
   and (s ->> 'measured')::int <= (s -> 'funnel' ->> 7)::int
$f$;

create function pg_temp.daily_txt(s jsonb) returns text
language sql as $f$
select string_agg((e ->> 'date') || ':' || (e ->> 'sessions') || '/' || (e ->> 'measured'), ',' order by e ->> 'date')
from jsonb_array_elements(s -> 'daily') e
$f$;

do $qa0193$
declare
  v_shop uuid;
  v_sid uuid;
  v_sid2 uuid;
  v_sid3 uuid;
  v_sid4 uuid;
  v_r text;
  v_state text;
  v_text text;
  v_text2 text;
  v_fails text;
  v_snap text;
  v_stats jsonb;
  v_row analytics.ring_size_session%rowtype;
  v_row2 analytics.ring_size_session%rowtype;
  v_cnt int;
  v_cnt2 int;
  v_num int;
  v_ok boolean;
  v_ok2 boolean;
  v_ok3 boolean;
  v_ok4 boolean;
  v_deleted int;
  v_i int;
  v_k int;
  v_t0 timestamptz;
  v_today date;
  v_log text;
  v_pass int;
  v_skip int;
  v_fail int;
  v_def_up text;
  v_def_st text;
  v_def_rt text;
  v_mut text;
  v_uid_owner uuid;
  v_ids uuid[];
  v_expected_keys text[] := array[
    'abandon_at', 'by_in_app', 'circ_hist', 'cta', 'daily', 'data_since', 'friction', 'funnel', 'measured', 'method',
    'method_stats', 'method_x_ref', 'ref', 'result_sizes', 'returning', 'saw_between', 'sessions', 'shop_range',
    'size_summary', 'switched'
  ];
  v_keys text[];
  v_bad text[];
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select id into v_shop from public.shop order by id limit 1;
  if v_shop is null then
    raise exception 'SETUP FAIL: ไม่พบ public.shop แม้แต่แถวเดียว ทดสอบต่อไม่ได้';
  end if;
  v_def_up := pg_get_functiondef('analytics.ring_size_session_upsert(uuid,uuid,jsonb)'::regprocedure);
  v_def_st := pg_get_functiondef('analytics.ring_size_stats(uuid,date,date)'::regprocedure);
  v_def_rt := pg_get_functiondef('analytics.ring_size_retention_apply()'::regprocedure);
  v_today := (now() at time zone 'Asia/Bangkok')::date;

  -- ====================================================================
  -- QA1 — fixture 5 session คิดมือ · ช่วง 2021-06-01..2021-06-07 (7 วัน = ขั้นต่ำ)
  --   A 06-01 09:00  tiktok · coin · เลือก B → วัดได้ 46 (ก้ำกึ่ง) → กด LINE
  --   B 06-02 21:30  line   · card · เลือก A → วัดได้ 44 (ต่ำกว่าช่วงร้าน) → กดแชร์
  --   C 06-03 23:59:59.999999 browser · card · เลือก A → เข้าหน้าวัดแล้วเลิก (max_stage 6)
  --   D 06-05 00:00  unknown · เปิดแล้วไป (max_stage 0)
  --   E 06-07 12:00  ig · coin · B เจอ G4 → สลับ A → วัดได้ 69 (สูงกว่าช่วงร้าน)
  -- คิดมือ: sessions 5 · returning 0 · measured 3 (A B E) · funnel [5,4,4,4,4,4,4,3] · abandon_at [1,0,0,0,0,0,1] (D · C)
  --   by_in_app line1 tiktok1 fb0 ig1 browser1 unknown1 · result_sizes 44/46/69 อย่างละ 1 · circ_hist 52/56/62 อย่างละ 1
  --   size_summary below1 in1 above1 between_count1 · method(ล่าสุด) A3 B1 · ref card2 coin2 · method_x_ref A_card2 A_coin1 B_card0 B_coin1
  --   cta line1 share1 shop0 gem0 · friction zoom0 calib0 invalid1 stale0 remeasured0
  --   method_stats A{picked3 (B C E) measured2 (B E) abandoned1 (C) invalid0 remeasured0 between null}
  --                B{picked2 (A E) measured1 (A) abandoned0 invalid1 (E) remeasured0 between1 (A)}
  --   switched a_to_b0 b_to_a1 (E) both1 (E) · saw_between 1 · daily 06-01 1/1 · 06-02 1/1 · 06-03 1/0 · 06-04 0/0 · 06-05 1/0 · 06-06 0/0 · 06-07 1/1
  -- ====================================================================
  v_sid := pg_temp.fx(v_shop, timestamptz '2021-06-01 09:00:00+07', '{"stage":0,"in_app":"tiktok"}');
  v_r := pg_temp.seq(v_shop, v_sid, array[
    '{"stage":1}', '{"stage":4,"ref":"coin"}', '{"stage":5,"method":"B"}', '{"stage":6}',
    '{"stage":7,"method":"B","circ_mm":56.5,"size":46,"between":true}', '{"stage":7,"cta":"line"}']);
  v_text := v_r;
  v_sid := pg_temp.fx(v_shop, timestamptz '2021-06-02 21:30:00+07', '{"stage":0,"in_app":"line"}');
  v_r := pg_temp.seq(v_shop, v_sid, array[
    '{"stage":1}', '{"stage":4,"ref":"card"}', '{"stage":5,"method":"A"}', '{"stage":6}',
    '{"stage":7,"method":"A","circ_mm":52.0,"size":44}', '{"stage":7,"cta":"share"}']);
  v_text := v_text || '/' || v_r;
  v_sid := pg_temp.fx(v_shop, timestamptz '2021-06-03 23:59:59.999999+07', '{"stage":0,"in_app":"browser"}');
  v_r := pg_temp.seq(v_shop, v_sid, array[
    '{"stage":1}', '{"stage":4,"ref":"card"}', '{"stage":5,"method":"A"}', '{"stage":6,"method":"A"}']);
  v_text := v_text || '/' || v_r;
  perform pg_temp.fx(v_shop, timestamptz '2021-06-05 00:00:00+07', '{"stage":0}');
  v_sid := pg_temp.fx(v_shop, timestamptz '2021-06-07 12:00:00+07', '{"stage":0,"in_app":"ig"}');
  v_r := pg_temp.seq(v_shop, v_sid, array[
    '{"stage":1}', '{"stage":4,"ref":"coin"}', '{"stage":5,"method":"B"}', '{"stage":6}',
    '{"stage":7,"method":"B","g4":true}', '{"stage":5,"method":"A"}', '{"stage":6}',
    '{"stage":7,"method":"A","circ_mm":62.0,"size":69}']);
  v_text := v_text || '/' || v_r;

  v_stats := analytics.ring_size_stats(v_shop, date '2021-06-01', date '2021-06-07');
  perform pg_temp.chk('QA1-0 (ยิง event ทั้ง 5 session ผ่าน RPC สำเร็จหมด ไม่มี error)', v_text = 'OK/OK/OK/OK', v_text);
  perform pg_temp.chk('QA1-a (sessions 5 · returning 0 · measured 3 · funnel [5,4,4,4,4,4,4,3] · abandon_at [1,0,0,0,0,0,1] · invariant 6 ข้อ)',
    (v_stats ->> 'sessions')::int = 5 and (v_stats ->> 'returning')::int = 0 and (v_stats ->> 'measured')::int = 3
      and v_stats -> 'funnel' = '[5,4,4,4,4,4,4,3]'::jsonb and v_stats -> 'abandon_at' = '[1,0,0,0,0,0,1]'::jsonb and pg_temp.inv(v_stats),
    v_stats::text);
  perform pg_temp.chk('QA1-b (by_in_app line1 tiktok1 fb0 ig1 browser1 unknown1 · ref card2 coin2 · method ล่าสุด A3 B1 · method_x_ref A_card2 A_coin1 B_card0 B_coin1)',
    v_stats -> 'by_in_app' = '{"line":1,"tiktok":1,"fb":0,"ig":1,"browser":1,"unknown":1}'::jsonb
      and v_stats -> 'ref' = '{"card":2,"coin":2}'::jsonb and v_stats -> 'method' = '{"A":3,"B":1}'::jsonb
      and v_stats -> 'method_x_ref' = '{"A_card":2,"A_coin":1,"B_card":0,"B_coin":1}'::jsonb,
    (v_stats -> 'by_in_app')::text || (v_stats -> 'ref')::text || (v_stats -> 'method')::text || (v_stats -> 'method_x_ref')::text);
  select string_agg((e ->> 'size') || 'x' || (e ->> 'count'), ',' order by (e ->> 'size')::int) into v_text
  from jsonb_array_elements(v_stats -> 'result_sizes') e;
  select string_agg((e ->> 'mm') || 'x' || (e ->> 'count'), ',' order by (e ->> 'mm')::int) into v_text2
  from jsonb_array_elements(v_stats -> 'circ_hist') e;
  perform pg_temp.chk('QA1-c (result_sizes 44/46/69 อย่างละ 1 · circ_hist 52/56/62 อย่างละ 1 (ปัดลง 1 มม.) · size_summary below1 in1 above1 between_count1)',
    v_text = '44x1,46x1,69x1' and v_text2 = '52x1,56x1,62x1'
      and v_stats -> 'size_summary' = '{"below_range":1,"in_range":1,"above_range":1,"between_count":1}'::jsonb,
    v_text || ' / ' || v_text2 || ' / ' || (v_stats -> 'size_summary')::text);
  perform pg_temp.chk('QA1-d (method_stats A{3,2,1,0,0,null} B{2,1,0,1,0,1} · switched a_to_b0 b_to_a1 both1 · saw_between 1)',
    v_stats -> 'method_stats' -> 'A' = '{"picked":3,"measured":2,"abandoned_at_measure":1,"invalid_sessions":0,"remeasured":0,"between":null}'::jsonb
      and v_stats -> 'method_stats' -> 'B' = '{"picked":2,"measured":1,"abandoned_at_measure":0,"invalid_sessions":1,"remeasured":0,"between":1}'::jsonb
      and v_stats -> 'switched' = '{"a_to_b":0,"b_to_a":1,"both":1}'::jsonb and (v_stats ->> 'saw_between')::int = 1,
    (v_stats -> 'method_stats')::text || (v_stats -> 'switched')::text);
  perform pg_temp.chk('QA1-e (cta line1 share1 shop0 gem0 · friction zoom0 calib0 invalid1 stale0 remeasured0 · daily 7 วันเทียบมือ)',
    v_stats -> 'cta' = '{"line":1,"share":1,"shop":0,"gem_quiz":0}'::jsonb
      and v_stats -> 'friction' = '{"zoom_blocked":0,"calib_warn":0,"invalid":1,"stale_recalib":0,"remeasured":0}'::jsonb
      and pg_temp.daily_txt(v_stats) = '2021-06-01:1/1,2021-06-02:1/1,2021-06-03:1/0,2021-06-04:0/0,2021-06-05:1/0,2021-06-06:0/0,2021-06-07:1/1',
    (v_stats -> 'cta')::text || (v_stats -> 'friction')::text || pg_temp.daily_txt(v_stats));
  -- ช่วงที่ขยับ 1 วัน: 06-02..06-08 ต้องไม่เห็น A (06-01) แต่เห็นทุกตัวที่เหลือ → sessions 4 measured 2
  v_stats := analytics.ring_size_stats(v_shop, date '2021-06-02', date '2021-06-08');
  perform pg_temp.chk('QA1-f (ช่วง 06-02..06-08: sessions 4 (ไม่รวม A) · measured 2 (B E) · funnel[7] 2 · invariant)',
    (v_stats ->> 'sessions')::int = 4 and (v_stats ->> 'measured')::int = 2 and (v_stats -> 'funnel' ->> 7)::int = 2 and pg_temp.inv(v_stats),
    v_stats::text);

  -- ====================================================================
  -- QA2 — ขอบวันไทยระดับไมโครวินาที · ช่วง 2021-07-10..2021-07-16
  --   X1 07-09 23:59:59.999999+07 นอก · X2 07-10 00:00:00+07 ใน · X3 07-16 23:59:59.999999+07 ใน · X4 07-17 00:00:00+07 นอก
  --   (UTC ของ X2 = 07-09 17:00 → ถ้าใช้วัน UTC X2 จะหลุดออก และ X4 (07-16 17:00 UTC) จะเข้ามา)
  --   และ X1 ถูกอัปเดตทีหลัง (updated_at = ตอนนี้) ต้องยังนับเป็นของ 07-09 ตาม created_at
  -- คิดมือ: sessions 2 · daily 07-10 1/0 · 07-16 1/0 · วันอื่น 0
  -- ====================================================================
  v_sid := pg_temp.fx(v_shop, timestamptz '2021-07-09 23:59:59.999999+07', '{"stage":0}');
  perform pg_temp.up(v_shop, v_sid, '{"stage":1}');   -- updated_at = now() (ปี 2026) · created_at ยังเป็น 07-09
  perform pg_temp.fx(v_shop, timestamptz '2021-07-10 00:00:00+07', '{"stage":0}');
  perform pg_temp.fx(v_shop, timestamptz '2021-07-16 23:59:59.999999+07', '{"stage":0}');
  perform pg_temp.fx(v_shop, timestamptz '2021-07-17 00:00:00+07', '{"stage":0}');
  v_stats := analytics.ring_size_stats(v_shop, date '2021-07-10', date '2021-07-16');
  perform pg_temp.chk('QA2a (ขอบไมโครวินาที: sessions 2 · daily 07-10 1/0 · 07-16 1/0 · วันกลาง 0 · X1 ที่ถูกอัปเดตทีหลังไม่ถูกนับ (นับตาม created_at))',
    (v_stats ->> 'sessions')::int = 2
      and pg_temp.daily_txt(v_stats) = '2021-07-10:1/0,2021-07-11:0/0,2021-07-12:0/0,2021-07-13:0/0,2021-07-14:0/0,2021-07-15:0/0,2021-07-16:1/0'
      and pg_temp.inv(v_stats),
    coalesce(pg_temp.daily_txt(v_stats), 'null'));
  v_stats := analytics.ring_size_stats(v_shop, date '2021-07-09', date '2021-07-17');
  perform pg_temp.chk('QA2b (ช่วงกว้างขึ้นหนึ่งวันสองด้าน 07-09..07-17: เห็นครบ 4 session · daily 07-09 1/0 · 07-17 1/0)',
    (v_stats ->> 'sessions')::int = 4
      and pg_temp.daily_txt(v_stats) = '2021-07-09:1/0,2021-07-10:1/0,2021-07-11:0/0,2021-07-12:0/0,2021-07-13:0/0,2021-07-14:0/0,2021-07-15:0/0,2021-07-16:1/0,2021-07-17:1/0',
    coalesce(pg_temp.daily_txt(v_stats), 'null'));

  -- mutant: stats ใช้วัน UTC แทนวันไทย ⇒ QA2a ต้องล้ม (X2 หลุด · X4 เข้า)
  v_mut := replace(v_def_st, 'Asia/Bangkok', 'UTC');
  if v_mut = v_def_st then
    perform pg_temp.chk('QA2-M (mutant: วัน UTC แทนวันไทย ⇒ QA2a ต้องล้ม)', false, 'needle Asia/Bangkok ไม่เจอในฟังก์ชัน');
  else
    execute v_mut;
    v_stats := analytics.ring_size_stats(v_shop, date '2021-07-10', date '2021-07-16');
    execute v_def_st;
    perform pg_temp.chk('QA2-M (mutant: วัน UTC แทนวันไทย ⇒ ตัวเลขต่างจากของจริง = QA2a จับได้)',
      not ((v_stats ->> 'sessions')::int = 2
        and pg_temp.daily_txt(v_stats) = '2021-07-10:1/0,2021-07-11:0/0,2021-07-12:0/0,2021-07-13:0/0,2021-07-14:0/0,2021-07-15:0/0,2021-07-16:1/0'),
      'mutant ให้ ' || coalesce(pg_temp.daily_txt(v_stats), 'null'));
  end if;

  -- ====================================================================
  -- QA3 — upsert ลำดับสลับ: ผล stage 7 มาถึงก่อน แล้ว stage 2/5/6/1/0 ตามมา (sendBeacon ไม่การันตีลำดับ)
  --   ต้อง: max_stage 7 · ผล (52 / 54.0 / result_method A) ไม่ถอย · measure_count 1 · cta_line คงอยู่ · in_app unknown→line ติด
  --   characterization (ตามดีไซน์ "ล่าสุดทับ" = ล่าสุดที่มาถึง ไม่ใช่ล่าสุดตามเวลาจริง): method กลายเป็น B · ref = card
  --   used_a จาก event แรก (stage 7 + method A) · used_b จาก stage 6 ที่มาทีหลังขณะ method = B
  -- ====================================================================
  v_sid := gen_random_uuid();
  v_r := pg_temp.seq(v_shop, v_sid, array[
    '{"stage":7,"method":"A","circ_mm":54.0,"size":52,"cta":"line"}', '{"stage":2,"ref":"card"}', '{"stage":5,"method":"B"}',
    '{"stage":6}', '{"stage":1}', '{"stage":0,"in_app":"line","is_return":true}']);
  select * into v_row from analytics.ring_size_session where id = v_sid;
  perform pg_temp.chk('QA3a (stage 7 มาก่อน แล้ว 2/5/6/1/0 ตามหลัง: max_stage 7 · result 52/54.0/A คงอยู่ · measure_count 1 (a1 b0) · cta_line · in_app line · is_return · events 6)',
    v_r = 'OK' and v_row.max_stage = 7 and v_row.result_size = 52 and v_row.circ_mm = 54.0 and v_row.result_method = 'A'
      and v_row.measure_count = 1 and v_row.measure_count_a = 1 and v_row.measure_count_b = 0 and v_row.cta_line
      and v_row.in_app = 'line' and v_row.is_return and v_row.event_count = 6 and v_row.in_shop_range = true,
    v_r || ' ' || to_jsonb(v_row)::text);
  perform pg_temp.chk('QA3b (characterization: method = B / ref = card (ล่าสุดที่มาถึงทับ) · used_a และ used_b ติดทั้งคู่ — ผลยังเป็นของ A เพราะ result_method)',
    v_row.method = 'B' and v_row.ref = 'card' and v_row.used_a and v_row.used_b, to_jsonb(v_row)::text);

  -- ====================================================================
  -- QA4 — sid เดิมครั้งที่ 41 ด้วย payload เต็ม ⇒ P0001 และทั้งแถวไม่ขยับ (เทียบ to_jsonb ก่อน/หลัง)
  --       41 ที่ payload ผิดรูป ⇒ 22023 (validation มาก่อน) · 41 ที่ร้านอื่น ⇒ 22023 (shop มาก่อน events)
  -- ====================================================================
  v_sid := gen_random_uuid();
  v_cnt := 0;
  for v_i in 1..40 loop
    if pg_temp.up(v_shop, v_sid, '{"stage":3}') = 'OK' then v_cnt := v_cnt + 1; end if;
  end loop;
  select * into v_row from analytics.ring_size_session where id = v_sid;
  v_state := pg_temp.up(v_shop, v_sid, '{"stage":7,"method":"B","circ_mm":55.5,"size":50,"between":true,"cta":"line","g1":true,"g4":true,"is_return":true,"in_app":"fb"}');
  select * into v_row2 from analytics.ring_size_session where id = v_sid;
  v_text := pg_temp.up(v_shop, v_sid, '{"stage":99}');
  v_text2 := pg_temp.up(gen_random_uuid(), v_sid, '{"stage":1}');
  perform pg_temp.chk('QA4 (40 ครั้งแรกสำเร็จ · ครั้งที่ 41 payload เต็ม ⇒ P0001 และ to_jsonb(แถว) ก่อน=หลัง ทุกคอลัมน์ · 41 payload ผิดรูป ⇒ 22023 · 41 ร้านอื่น ⇒ 22023)',
    v_cnt = 40 and v_state = 'P0001' and to_jsonb(v_row) = to_jsonb(v_row2) and v_row2.event_count = 40
      and v_text = '22023' and v_text2 = '22023',
    format('ok=%s 41st=%s bad=%s other=%s same=%s', v_cnt, v_state, v_text, v_text2, to_jsonb(v_row) = to_jsonb(v_row2)));

  -- ====================================================================
  -- QA7 — stats วันที่สุดขอบ: infinity / ปีไกล · ต้อง "ถูกปฏิเสธ" (ไม่ใช่ OK) · บันทึก sqlstate จริง (หวัง 22023)
  -- ====================================================================
  v_text := pg_temp.st(v_shop, 'infinity'::date, 'infinity'::date) || '/' || pg_temp.st(v_shop, '-infinity'::date, date '2020-01-01') || '/'
         || pg_temp.st(v_shop, date '2020-01-01', 'infinity'::date) || '/' || pg_temp.st(v_shop, date '4713-01-01 BC', date '2020-01-01');
  v_state := pg_temp.st(v_shop, date '9999-12-25', date '9999-12-31');
  perform pg_temp.chk('QA7 (infinity / -infinity / ปี 4713 BC → ไม่ใช่ OK ทุกตัว · ปลายปี 9999 ช่วง 7 วัน ⇒ OK ไม่ overflow) — ดู detail ว่า sqlstate เป็น 22023 หรือไม่',
    position('OK' in v_text) = 0 and v_state = 'OK', 'states=' || v_text || ' y9999=' || v_state);
  raise notice '[detail] QA7 states(inf/inf, -inf, inf, 4713BC)=% y9999=%', v_text, v_state;

  -- ====================================================================
  -- QA8 — characterization (ตามดีไซน์ "ผลวัดทับเป็นก้อน"): event stage 7 ที่มี circ_mm แต่ไม่มี size ล้าง result_size/in_shop_range เป็น null
  --       ⇒ measured ของ session นั้นหายไป (client ที่ทำตามสัญญา §0 ส่ง circ+size คู่เสมอ จึงไม่เกิด) · invariant measured<=funnel[7] ยังจริง
  -- ====================================================================
  v_sid := pg_temp.fx(v_shop, timestamptz '2021-08-02 10:00:00+07', '{"stage":7,"method":"A","circ_mm":54.0,"size":52}');
  select result_size into v_num from analytics.ring_size_session where id = v_sid;
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":55.0}');
  select * into v_row from analytics.ring_size_session where id = v_sid;
  v_stats := analytics.ring_size_stats(v_shop, date '2021-08-01', date '2021-08-07');
  perform pg_temp.chk('QA8 (characterization: stage 7 + circ_mm ไม่มี size ⇒ result_size 52 → null · circ 55.0 · in_shop_range null · measured 0 แต่ funnel[7] 1 · invariant ผ่าน)',
    v_num = 52 and v_row.result_size is null and v_row.circ_mm = 55.0 and v_row.in_shop_range is null
      and (v_stats ->> 'measured')::int = 0 and (v_stats -> 'funnel' ->> 7)::int = 1 and pg_temp.inv(v_stats),
    to_jsonb(v_row)::text);

  -- ====================================================================
  -- QA9 — JSON แปลก ๆ ตรงเข้า RPC (route ตรวจก่อนแล้ว แต่ RPC ต้องรับมือเองถ้าถูกเรียกตรง)
  -- ====================================================================
  v_fails := '';
  foreach v_snap in array array[
    '{"stage":1,"ไซส์":1}',                                   -- key ภาษาไทย
    '{"stage":1,"in_app":"line😀"}',                         -- emoji ต่อท้ายค่า enum
    '{"stage":1,"in_app":"ｌｉｎｅ"}',                           -- fullwidth
    '{"stage":1,"in_app ":"line"}',                           -- key มีช่องว่างท้าย
    '{"stage":1,"stage":9}',                                  -- key ซ้ำ ค่าสุดท้ายชนะ = 9 ⇒ ผิดช่วง
    '{"stage":"７"}',                                         -- ตัวเลข fullwidth ใน string
    '{"stage":7,"size":52.0000000000000000001}',              -- ไม่ใช่จำนวนเต็มจริง
    '{"stage":1e999999999}',                                  -- ล้น numeric
    '{"stage":7,"circ_mm":1e5000}',                           -- ล้นช่วง
    '{"stage":1,"cta":"line","in_app":"line","method":"A","ref":"coin","is_return":true,"g1":true,"g3":true,"g4":true,"g5":true,"used_a":true,"used_b":true,"saw_between":true,"in_range":true,"between":true}' -- 15 key ครบแต่ between ที่ stage 1
  ] loop
    v_sid := gen_random_uuid();
    v_state := pg_temp.up(v_shop, v_sid, v_snap);
    select count(*) into v_cnt from analytics.ring_size_session where id = v_sid;
    if v_state = 'OK' or v_cnt <> 0 then v_fails := v_fails || format(' [%s => %s rows=%s]', left(v_snap, 40), v_state, v_cnt); end if;
  end loop;
  perform pg_temp.chk('QA9a (JSON ผิดรูป/แปลก 10 แบบ ⇒ ถูกปฏิเสธทุกตัว ไม่มีแถวหลุดเข้าตาราง)', v_fails = '', v_fails);

  v_fails := '';
  foreach v_snap in array array[
    '{"stage":9,"stage":1}',                                  -- key ซ้ำ ค่าสุดท้าย = 1 ผ่าน
    '{"stage":1.0}',
    '  {"stage":1}  ',
    '{"stage":7,"circ_mm":5.4e1,"size":5.2e1}',               -- เลขวิทยาศาสตร์ = 54 / 52
    '{"stage":7,"circ_mm":54.04999,"size":52}',
    '{"stage":7,"circ_mm":119.96,"size":90}'                  -- ปัดเป็น 120.0 ต้องไม่ล้น numeric(4,1)
  ] loop
    v_sid := gen_random_uuid();
    v_state := pg_temp.up(v_shop, v_sid, v_snap);
    if v_state <> 'OK' then v_fails := v_fails || format(' [%s => %s]', left(v_snap, 40), v_state); end if;
  end loop;
  perform pg_temp.chk('QA9b (ต้องไม่พัง: key ซ้ำค่าท้ายถูกต้อง · 1.0 · เว้นวรรค · 5.4e1/5.2e1 · ทศนิยมยาว · 119.96→120.0 ผ่านหมด)', v_fails = '', v_fails);
  v_sid := gen_random_uuid();
  perform pg_temp.up(v_shop, v_sid, '{"stage":7,"circ_mm":5.4e1,"size":5.2e1}');
  select circ_mm, result_size into v_num, v_cnt from analytics.ring_size_session where id = v_sid;
  v_sid2 := gen_random_uuid();
  perform pg_temp.up(v_shop, v_sid2, '{"stage":7,"circ_mm":119.96,"size":90}');
  perform pg_temp.chk('QA9c (5.4e1 → circ 54 size 52 · 119.96 → circ_mm 120.0)',
    v_num = 54 and v_cnt = 52
      and (select circ_mm from analytics.ring_size_session where id = v_sid2) = 120.0,
    format('%s/%s', v_num, v_cnt));

  -- ====================================================================
  -- QA10 — stats shape ล็อก 20 key เป๊ะ + ไม่มี uuid / เวลาระดับนาที / ข้อความ รั่วในผล (PDPA: ไม่คืนแถวดิบ)
  -- ====================================================================
  v_stats := analytics.ring_size_stats(v_shop, date '2021-06-01', date '2021-06-07');
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v_stats) k;
  perform pg_temp.chk('QA10a (stats คืน key 20 ตัวตรงรายการเป๊ะ — เพิ่ม key = ต้องทบทวน PDPA)',
    v_keys = v_expected_keys, array_to_string(v_keys, ','));
  perform pg_temp.chk('QA10b (ผล stats ไม่มี uuid · ไม่มีเวลา hh:mm · ไม่มี src/ip/ua/shop_id)',
    v_stats::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}'
      and v_stats::text !~ '[0-9]{2}:[0-9]{2}'
      and v_stats::text !~* '"(src|ip|ua|user_agent|shop_id|id|sid|session_id)"',
    left(v_stats::text, 200));

  -- ====================================================================
  -- QA6 — จำนวนมาก: 1,500 session กระจายเต็มช่วงเพดาน 180 วัน (2022-01-01..2022-06-29 · diff 179) · stage = i mod 8 · stage 7 พกผล
  --   ใช้ปี 2022 เพื่อไม่ปนข้อมูลจริง (ฟีเจอร์นี้เกิดปี 2026)
  -- คิดมือ: residue 0-3 มี 188 ตัว · residue 4-7 มี 187 ตัว (1500 = 8×187 + 4) · stage 7 = residue 7 = 187 session (j = i div 8 = 0..186)
  --   sessions 1500 · measured 187 · funnel[0] 1500 · funnel[7] 187 · abandon_at [188,188,188,188,187,187,187] (รวม 1313 + 187 = 1500)
  --   funnel = [1500,1312,1124,936,748,561,374,187]  (ลบ 188 ×4 แล้ว 187 ×3 ทีละขั้น)
  --   เบอร์ของ stage 7 ตาม j mod 3: 0→44 (ต่ำกว่าช่วงร้าน) 1→50 (ในช่วง) 2→69 (สูงกว่าช่วง) · j=0..186 ⇒ 63 / 62 / 62
  --   ⇒ result_sizes 44x63,50x62,69x62 · size_summary below63 in62 above62 between0 · circ_hist 55x187
  -- ====================================================================
  v_t0 := clock_timestamp();
  for v_i in 0..1499 loop
    v_k := v_i % 8;
    perform pg_temp.fx(v_shop,
      (((date '2022-01-01' + (v_i % 180))::timestamp + interval '12 hours') at time zone 'Asia/Bangkok'),
      case when v_k = 7 then format('{"stage":7,"method":"A","circ_mm":55.0,"size":%s}',
                                    case (v_i / 8) % 3 when 0 then 44 when 1 then 50 else 69 end)
           else format('{"stage":%s}', v_k) end);
  end loop;
  v_text := 'build=' || round(extract(epoch from clock_timestamp() - v_t0)::numeric, 2) || 's';
  v_t0 := clock_timestamp();
  v_stats := analytics.ring_size_stats(v_shop, date '2022-01-01', date '2022-01-01' + 179);
  v_text2 := 'stats=' || round(extract(epoch from clock_timestamp() - v_t0)::numeric, 3) || 's';
  raise notice '[detail] QA6 % %', v_text, v_text2;
  perform pg_temp.chk('QA6a (1,500 session ช่วง 180 วันเต็ม: sessions 1500 · measured 187 · funnel [1500,1312,1124,936,748,561,374,187] · abandon_at [188,188,188,188,187,187,187] · invariant · daily 180 วัน)',
    (v_stats ->> 'sessions')::int = 1500 and (v_stats ->> 'measured')::int = 187
      and v_stats -> 'funnel' = '[1500,1312,1124,936,748,561,374,187]'::jsonb
      and v_stats -> 'abandon_at' = '[188,188,188,188,187,187,187]'::jsonb
      and pg_temp.inv(v_stats) and jsonb_array_length(v_stats -> 'daily') = 180,
    v_text || ' ' || v_text2 || ' ' || left(v_stats::text, 200));
  perform pg_temp.chk('QA6b (เวลา stats บน 1,500 แถว < 5 วินาที — ' || v_text2 || ')',
    extract(epoch from clock_timestamp() - v_t0) < 5, v_text2);
  select string_agg((e ->> 'size') || 'x' || (e ->> 'count'), ',' order by (e ->> 'size')::int) into v_text
  from jsonb_array_elements(v_stats -> 'result_sizes') e;
  perform pg_temp.chk('QA6c (result_sizes 44x63,50x62,69x62 · size_summary below63 in62 above62 between0 · circ_hist 55x187)',
    v_text = '44x63,50x62,69x62'
      and v_stats -> 'size_summary' = '{"below_range":63,"in_range":62,"above_range":62,"between_count":0}'::jsonb
      and v_stats -> 'circ_hist' = '[{"mm":55,"count":187}]'::jsonb,
    v_text || ' ' || (v_stats -> 'size_summary')::text || ' ' || (v_stats -> 'circ_hist')::text);

  -- ====================================================================
  -- QA13 — staff จริง: สลับ role ของ owner/admin เดิมเป็น staff "ในทรานแซกชันนี้" (rollback ทิ้ง) ⇒ stats ต้อง 42501
  --        แทน T13c ของ dev ที่ SKIP เพราะไม่มี staff บน DB · ไม่แตะ auth.users
  -- ====================================================================
  select user_id into v_uid_owner from public.shop_member where shop_id = v_shop and role in ('owner', 'admin') limit 1;
  if v_uid_owner is null then
    insert into _vr (name, ok, detail) values ('QA13 (staff จริง ⇒ 42501) — ไม่มี owner/admin ใน shop_member ให้สลับ role', null, 'skip');
    raise notice '[live] QA13 = SKIP (ไม่มี owner/admin)';
  else
    begin
      update public.shop_member set role = 'staff' where shop_id = v_shop and user_id = v_uid_owner;
      perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', v_uid_owner), true);
      v_state := pg_temp.st(v_shop, date '2021-06-01', date '2021-06-07');
      v_text := pg_temp.st(v_shop, date '2021-06-07', date '2021-06-01');   -- พารามิเตอร์ผิด + staff ⇒ ต้องตกที่สิทธิ์ก่อน
      perform pg_temp.chk('QA13a (staff จริง (owner เดิมถูกสลับเป็น staff ในทรานแซกชัน) ⇒ 42501 · พารามิเตอร์ผิดก็ตกที่สิทธิ์ก่อน)',
        v_state = '42501' and v_text = '42501', v_state || '/' || v_text);
      update public.shop_member set role = 'admin' where shop_id = v_shop and user_id = v_uid_owner;
      v_state := pg_temp.st(v_shop, date '2021-06-01', date '2021-06-07');
      perform pg_temp.chk('QA13b (ต้องไม่พัง: role admin ของคนเดียวกัน ⇒ OK)', v_state = 'OK', v_state);
    exception when others then
      raise notice '[live] QA13 = SKIP (สลับ role ในทรานแซกชันไม่ได้: %)', sqlstate;
      insert into _vr (name, ok, detail) values ('QA13 (staff จริง ⇒ 42501) — สลับ role ไม่ได้ sqlstate ' || sqlstate, null, 'skip');
    end;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  end if;

  -- ====================================================================
  -- QA14 — circuit breaker: ขอบหน้าต่าง 10 นาที (created_at > now() - 10 นาที · เทียบ strict)
  --   สร้าง 300 แถวที่ created_at = now() - 9 นาที (ผ่าน fx: ตอน insert แต่ละตัวนับ 0..299 < 300 จึงผ่านหมด)
  --   ⇒ session ใหม่ต้อง P0001 · ย้ายแถวหนึ่งไปพอดี now() - 10 นาที (ไม่นับ) ⇒ session ใหม่ผ่าน · ย้ายกลับ 9 นาที ⇒ P0001 อีก
  --   (baseline: ต้องไม่มีแถวอื่นของร้านนี้อยู่ในหน้าต่าง — QA6 วางแถวไว้ที่ 12:00 ไทยของวัน · ถ้าวันนี้เวลาไทยยังไม่ถึง 12:00 แถวของ
  --    "วันนี้" อยู่อนาคต (> now) และนับเข้าหน้าต่าง ⇒ คำนวณ baseline จริงแล้วชดเชย)
  -- ====================================================================
  select count(*) into v_cnt from analytics.ring_size_session where shop_id = v_shop and created_at > now() - interval '10 minutes';
  v_ids := array[]::uuid[];
  v_state := 'OK';
  for v_i in 1..(300 - v_cnt) loop
    v_sid := pg_temp.fx(v_shop, now() - interval '9 minutes', '{"stage":0}');
    v_ids := v_ids || v_sid;
  end loop;
  select count(*) into v_cnt2 from analytics.ring_size_session where shop_id = v_shop and created_at > now() - interval '10 minutes';
  v_text := pg_temp.up(v_shop, gen_random_uuid(), '{"stage":0}');
  perform pg_temp.chk('QA14a (หน้าต่างเต็ม 300 แถว (แถว 9 นาทีนับรวม) ⇒ session ใหม่ P0001)', v_cnt2 = 300 and v_text = 'P0001',
    format('window=%s new=%s', v_cnt2, v_text));
  update analytics.ring_size_session set created_at = now() - interval '10 minutes' where id = v_ids[1];
  v_text := pg_temp.up(v_shop, gen_random_uuid(), '{"stage":0}');
  update analytics.ring_size_session set created_at = now() - interval '9 minutes 59 seconds' where id = v_ids[1];
  v_text2 := pg_temp.up(v_shop, gen_random_uuid(), '{"stage":0}');
  perform pg_temp.chk('QA14b (ขอบ: แถวพอดี 10 นาที ไม่นับ ⇒ ช่องว่าง 1 ⇒ session ใหม่ OK · แถว 9:59 นับ ⇒ P0001 อีก (หน้าต่างกลับเต็ม ← session ที่เพิ่งผ่านใช้ที่ว่างแล้ว))',
    v_text = 'OK' and v_text2 = 'P0001', format('at10min=%s at9m59=%s', v_text, v_text2));

  -- mutant: หน้าต่าง 1 นาทีแทน 10 นาที ⇒ แถวอายุ 9 นาทีไม่ถูกนับ ⇒ session ใหม่ผ่าน (QA14a ต้องจับได้)
  v_mut := replace(v_def_up, 'created_at > now() - interval ''10 minutes''', 'created_at > now() - interval ''1 minute''');
  if v_mut = v_def_up then
    perform pg_temp.chk('QA14-M (mutant: หน้าต่าง 1 นาที ⇒ QA14a ต้องล้ม)', false, 'needle หน้าต่าง 10 นาทีไม่เจอในฟังก์ชัน');
  else
    execute v_mut;
    v_text := pg_temp.up(v_shop, gen_random_uuid(), '{"stage":0}');
    execute v_def_up;
    perform pg_temp.chk('QA14-M (mutant: หน้าต่าง 1 นาที ⇒ session ใหม่ผ่าน (OK) ไม่ใช่ P0001 = QA14a จับได้)', v_text = 'OK', 'mutant ให้ผล ' || v_text);
  end if;

  -- ====================================================================
  -- QA5 — retention ขอบละเอียด (ต้องอยู่ท้ายสุด: ลบแถวเก่าของ QA1/2/8 ด้วย)
  --   r1 พอดี 180 วัน (created_at = now()-180d ⇒ ไม่ < ⇒ อยู่) · r2 เกิน 1 ไมโครวินาที (หาย) · r3 179 วัน 23:59 (อยู่)
  --   r4 สร้าง 200 วันก่อนแต่ถูกอัปเดตเมื่อกี้ (updated_at ใหม่) ⇒ นับ created_at ⇒ หาย
  -- ====================================================================
  -- ย้ายแถวทั้งหมดที่ยังอยู่ในหน้าต่าง breaker (QA14 ทิ้งไว้เต็ม 300) ออกไป 1 ชั่วโมงก่อน — ไม่งั้น fx ด้านล่างโดน P0001
  update analytics.ring_size_session set created_at = created_at - interval '1 hour'
   where shop_id = v_shop and created_at > now() - interval '10 minutes';
  v_sid  := pg_temp.fx(v_shop, now() - interval '180 days', '{"stage":1}');
  v_sid2 := pg_temp.fx(v_shop, now() - interval '180 days' - interval '1 microsecond', '{"stage":1}');
  v_sid3 := pg_temp.fx(v_shop, now() - interval '179 days 23 hours 59 minutes', '{"stage":1}');
  v_sid4 := pg_temp.fx(v_shop, now() - interval '200 days', '{"stage":1}');
  perform pg_temp.up(v_shop, v_sid4, '{"stage":2}');
  v_deleted := analytics.ring_size_retention_apply();
  select exists (select 1 from analytics.ring_size_session where id = v_sid),
         exists (select 1 from analytics.ring_size_session where id = v_sid2),
         exists (select 1 from analytics.ring_size_session where id = v_sid3),
         exists (select 1 from analytics.ring_size_session where id = v_sid4)
    into v_ok, v_ok2, v_ok3, v_ok4;
  select count(*) into v_cnt from analytics.ring_size_session where created_at < now() - interval '180 days';
  perform pg_temp.chk('QA5a (retention: พอดี 180 วัน อยู่ · เกิน 1 µs หาย · 179 วัน 23:59 อยู่ · สร้าง 200 วันก่อนแม้อัปเดตใหม่ก็หาย · ไม่เหลือแถว > 180 วัน · ลบ ≥ 2)',
    v_ok and not v_ok2 and v_ok3 and not v_ok4 and v_cnt = 0 and v_deleted >= 2,
    format('r1=%s r2=%s r3=%s r4=%s leftover=%s deleted=%s', v_ok, v_ok2, v_ok3, v_ok4, v_cnt, v_deleted));

  -- mutant: `<` เป็น `<=` ⇒ r1 (พอดี 180 วัน) ถูกลบ ⇒ QA5a ต้องจับได้
  v_sid := pg_temp.fx(v_shop, now() - interval '180 days', '{"stage":1}');
  v_mut := replace(v_def_rt, 'created_at < now()', 'created_at <= now()');
  if v_mut = v_def_rt then
    perform pg_temp.chk('QA5-M (mutant: <= ⇒ QA5a ต้องล้ม)', false, 'needle created_at < now() ไม่เจอในฟังก์ชัน');
  else
    execute v_mut;
    v_deleted := analytics.ring_size_retention_apply();
    select exists (select 1 from analytics.ring_size_session where id = v_sid) into v_ok;
    execute v_def_rt;
    perform pg_temp.chk('QA5-M (mutant: <= ⇒ แถวพอดี 180 วันถูกลบ (ไม่ใช่อยู่) = QA5a จับได้)', v_ok = false, 'mutant: r1 รอด=' || v_ok);
  end if;

  -- ====================================================================
  -- สรุป + ตรวจว่า mutant restore แล้วทุกตัว
  -- ====================================================================
  perform pg_temp.chk('QA-R (restore: ฟังก์ชัน upsert/stats/retention กลับเป็นเดิมเป๊ะหลัง mutant — เทียบ md5)',
    md5(pg_get_functiondef('analytics.ring_size_session_upsert(uuid,uuid,jsonb)'::regprocedure)) = md5(v_def_up)
    and md5(pg_get_functiondef('analytics.ring_size_stats(uuid,date,date)'::regprocedure)) = md5(v_def_st)
    and md5(pg_get_functiondef('analytics.ring_size_retention_apply()'::regprocedure)) = md5(v_def_rt));
  select count(*) into v_cnt from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.pronamespace = 'analytics'::regnamespace and p.proname like 'ring\_size\_%' and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  perform pg_temp.chk('QA-G (หลัง mutant: ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE บน ring_size_*)', v_cnt = 0, 'leaks=' || v_cnt);

  select count(*) filter (where ok is true), count(*) filter (where ok is null), count(*) filter (where ok is false)
    into v_pass, v_skip, v_fail from _vr;
  select string_agg(format('%s: %s%s', name,
                           case when ok is null then 'SKIP' when ok then 'PASS' else 'FAIL' end,
                           case when ok is true then '' else ' — ' || coalesce(detail, '') end), E'\n' order by n)
    into v_log from _vr;
  raise exception E'\n=== verify-0193-qa (ring_size_analytics QA) ===\n%\n--- PASS=% SKIP=% FAIL=% (ทั้งก้อน rollback แล้ว — DB ไม่ขยับ) ---', v_log, v_pass, v_skip, v_fail;
end;
$qa0193$;
