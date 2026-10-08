-- scripts/verify/qa-0162-round2.sql  (QA R2-D2 · รอบ 2 · 7 ต.ค. 69 · เคสอิสระ "คิดว่าจะพังยังไง" ต่อจาก verify-0162 + qa-0162-extra)
--
-- self-rolling-back do-block (3j-migration-traps #11): ทุกเคสเก็บผลลง v_log แล้ว raise exception ปิดท้ายเสมอ ⇒ ROLLBACK ทั้งหมด · DB จริงไม่ขยับ
-- ใช้ร้านทดสอบที่สร้างในทรานแซกชันเอง (ไม่แตะแถวจริง) · ร้านจริงต้องมีร้านเดียว
-- รัน (dry-run ก่อน apply): ต่อ 0161 + 0162 + ไฟล์นี้เป็นไฟล์เดียว (ใช้เนื้อ LF จาก git — ไม่ใช่ working copy CRLF) แล้ว node scripts/run-sql.mjs <ไฟล์> (ไม่ใส่ --commit)
--
-- แมปเคส (ข้อในบรีฟรอบ 2 → id):
--   TOK  md5 token CAS (campaign): ทุกฟิลด์ใน token ขยับ token → T1 · ไม่ขึ้นกับ TimeZone/DateStyle → T2 · ฟิลด์นอก token ไม่ขยับ → T3 ·
--        token ผิดรูปแบบ/เก่า/null/'' /ของแคมเปญอื่น/ของ reco/expected_proposed ผิด → T4 · ยืนยันซ้ำด้วย token เดิม (เลียนแข่งกัน 2 ครั้ง: ตัวหลังต้องแพ้) → T5
--   RTOK md5 token CAS (reco): ทุกฟิลด์ใน token ขยับ → RT1 · TimeZone → RT2 · token ผิด/ข้ามชนิด → RT3 · respond ซ้ำ → RT4
--   CRE  recommendation_create คืน jsonb {id,created,conflict} → C1 · ชื่อซ้ำ (case/ช่องว่าง/ZWSP/ไทย) คืน id เดิม → C2 · ตอบแล้วสร้างใหม่ได้ → C3 · conflict ตามเนื้อหา → C4 ·
--        เรียกซ้ำ 20 ครั้ง → C5 · ข้ามร้าน → C6 · ขอบความยาว/เส้นตาย/effort → C7 · kind/source/actor → C8 · SQL-injection ในชื่อ → C9
--   LOCK คำตอบเจ้าของล็อกแล้วแก้ไม่ได้ → L1 · AI/system ตอบแทนไม่ได้ → L2 · action ผิด → L3 · rejected ต้องมีเหตุผล → L4 · ตอบช้ายังตอบได้ → L5
--   AIP  AI แก้แผนหลังเริ่มไม่ได้ → P1 (ล้างวันเริ่มช่วงนับ) · P2 (หลัง owner เสนอ) · P3 (ต้องไม่พัง ก่อนเริ่ม)
--   ORD  คำตัดสิน orders ต้องข้อมูลครอบช่วง (ขาด 1 วัน = ห้ามตัดสิน) → D1-D6 · เจ้าของขยายช่วงหลัง AI เสนอ → D7 · ข้อมูลหายหลังเสนอ → D8
--   Q12  ปิดแคมเปญที่มีชิ้นค้าง: ไม่ปฏิเสธ · ชิ้นไม่ถูกแตะ · นับใหม่เมื่อยืนยันซ้ำ → Q1-Q4
--   LES  บทเรียน: null คงเดิม · '' ล้าง · ขอบ 300 (ไทย/อีโมจิ) · ล้มแล้วไม่สร้างสัญญาณ → LE1-LE8
--
-- ⚠️ บอกตรงๆ: 2 connection จริงไม่ได้ (do-block เดียว) — "แข่งกัน" ที่นี่ = เรียกซ้ำตามลำดับด้วย token เดิม · for update พิสูจน์ด้วย connection เดียวไม่ได้ → [SKIP] ท้ายไฟล์
-- ⚠️ เวลา now() คงที่ตลอดทรานแซกชัน — ฟิลด์ที่เป็นเวลา (proposed_at/confirmed_at) ขยับใน token ไม่ได้ในไฟล์นี้ (จึงแยกพิสูจน์ที่ role/ข้อความ/ผลยืนยันแทน)

create or replace function pg_temp.vx(p_sql text, p_expect text[], p_like text default null) returns text
 language plpgsql as $vx$
declare v_state text; v_msg text;
begin
  execute p_sql;
  return 'FAIL ผ่านทั้งที่ควรปฏิเสธ';
exception when others then
  get stacked diagnostics v_msg = message_text;
  v_state := sqlstate;
  if v_state = any (p_expect) then
    if p_like is not null and position(p_like in v_msg) = 0 then
      return 'FAIL sqlstate ถูก (' || v_state || ') แต่ข้อความไม่มี "' || p_like || '" → ' || left(v_msg, 200);
    end if;
    return 'OK ' || v_state || ' msg=' || left(v_msg, 90);
  end if;
  return 'FAIL sqlstate=' || v_state || ' msg=' || left(v_msg, 160);
end $vx$;

create or replace function pg_temp.vok(p_sql text) returns text
 language plpgsql as $vk$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return 'FAIL ควรสำเร็จแต่ตก sqlstate=' || sqlstate || ' msg=' || left(sqlerrm, 200);
end $vk$;

create or replace function pg_temp.vl(p_id text, p_what text, p_res text) returns text
 language sql as $vl$
  select '[' || case when p_res like 'OK%' and p_res not like '%FAIL%' then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what || ' → ' || p_res || E'\n'
$vl$;

create or replace function pg_temp.vb(p_id text, p_what text, p_cond boolean, p_detail text default '') returns text
 language sql as $vb$
  select '[' || case when p_cond is true then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what
         || case when p_detail <> '' then ' → ' || p_detail else '' end || E'\n'
$vb$;

-- SQL ที่ควรสำเร็จ → jsonb ของผล (ล้มเหลว → {"error": sqlstate, "msg": ...})
create or replace function pg_temp.vj(p_sql text) returns jsonb
 language plpgsql as $vj$
declare v_j jsonb;
begin
  execute p_sql into v_j;
  return v_j;
exception when others then
  return jsonb_build_object('error', sqlstate, 'msg', left(sqlerrm, 200));
end $vj$;

create or replace function pg_temp.q_plan(p_shop uuid, p_camp uuid, p_set text, p_role text) returns text
 language sql as $q$
  select format('select analytics.campaign_plan_set(%L::uuid,%L::uuid,%L::jsonb,%L)', p_shop, p_camp, p_set, p_role)
$q$;
create or replace function pg_temp.q_prop(p_shop uuid, p_camp uuid, p_verdict text, p_note text, p_role text) returns text
 language sql as $q$
  select format('select analytics.campaign_verdict_propose(%L::uuid,%L::uuid,%L,%L,%L)', p_shop, p_camp, p_verdict, p_note, p_role)
$q$;
-- p_tok = 'auto' → token ปัจจุบัน ณ ตอนรัน · ค่าอื่น/null = ตามนั้น
create or replace function pg_temp.q_conf(p_shop uuid, p_camp uuid, p_verdict text, p_lesson text, p_role text, p_note text, p_exp text, p_tok text default 'auto') returns text
 language sql as $q$
  select format('select analytics.campaign_verdict_confirm(%L::uuid,%L::uuid,%L,%L,%L,%L,%L,%s)', p_shop, p_camp, p_verdict, p_lesson, p_role, p_note, p_exp,
                case when p_tok = 'auto' then format('analytics.campaign_verdict_token_(%L::uuid)', p_camp) else format('%L', p_tok) end)
$q$;
create or replace function pg_temp.q_rcreate(p_shop uuid, p_title text, p_detail text, p_role text, p_kind text default 'proposal',
                                             p_source text default 'agent', p_effort int default null, p_resp text default null,
                                             p_def text default null, p_camp uuid default null, p_step uuid default null, p_sum uuid default null) returns text
 language sql as $q$
  select format('select to_jsonb(analytics.recommendation_create(%L::uuid,%L,%L,%L,%L,%L,%L::int,%L::date,%L,%L::uuid,%L::uuid,%L::uuid))',
                p_shop, p_title, p_detail, p_role, p_kind, p_source, p_effort, p_resp, p_def, p_camp, p_step, p_sum)
$q$;
create or replace function pg_temp.q_rresp(p_shop uuid, p_id uuid, p_action text, p_resp text, p_role text, p_tok text default 'auto') returns text
 language sql as $q$
  select format('select analytics.recommendation_respond(%L::uuid,%L::uuid,%L,%L,%L,%s)', p_shop, p_id, p_action, p_resp, p_role,
                case when p_tok = 'auto' then format('analytics.recommendation_token_(%L::uuid)', p_id) else format('%L', p_tok) end)
$q$;

create or replace function pg_temp.ext() returns text
 language sql as $ex$ select 'r2-' || substr(gen_random_uuid()::text, 1, 12) $ex$;
create or replace function pg_temp.url(p_ext text default null) returns text
 language sql as $ur$ select 'https://www.tiktok.com/@qar2/video/' || coalesce(p_ext, substr(gen_random_uuid()::text, 1, 12)) $ur$;

-- แคมเปญทดสอบผ่าน RPC จริง (ชิ้นแรกวัน p_anchor · null = ไอเดียไม่มีวัน)
create or replace function pg_temp.mk_camp(p_shop uuid, p_anchor date) returns uuid
 language plpgsql as $mc$
declare v_s uuid;
begin
  v_s := analytics.content_piece_create(p_shop, 'qa-0162-r2 camp ' || substr(gen_random_uuid()::text, 1, 8), 'short_clip', 'tiktok', 'jewelry_925', 'owner', p_anchor);
  return (select campaign_id from analytics.campaign_step where id = v_s);
end $mc$;

create or replace function pg_temp.mk_piece_in(p_shop uuid, p_camp uuid, p_anchor date) returns uuid
 language plpgsql as $mp$
declare
  v_s uuid;
  v_a uuid;
begin
  v_s := analytics.content_piece_create(p_shop, 'qa-0162-r2 piece ' || substr(gen_random_uuid()::text, 1, 8), 'short_clip', 'tiktok', 'jewelry_925', 'owner', p_anchor, null, p_camp);
  perform analytics.content_piece_advance(p_shop, v_s, 'drafting', 'owner');
  select a.id into v_a from analytics.step_artifact a where a.step_id = v_s;
  perform analytics.content_hook_upsert(p_shop, v_s, 'A', 'qa hook A', 'question', null, 'owner', null);
  perform analytics.content_hook_upsert(p_shop, v_s, 'B', 'qa hook B', 'fact', null, 'owner', null);
  perform analytics.campaign_set_artifact_content(v_a, 'qa body',
    jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
                       'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'ถ่ายหน้าโต๊ะ'),
                                                  jsonb_build_object('id', 's2', 'desc', 'ใกล้ๆ'))));
  perform analytics.content_piece_advance(p_shop, v_s, 'in_review', 'owner');
  return v_s;
end $mp$;

create or replace function pg_temp.mk_posted_in(p_shop uuid, p_camp uuid, p_anchor date, p_idx int) returns uuid
 language plpgsql as $mpo$
declare
  v_s    uuid;
  v_hook uuid;
  v_ext  text := pg_temp.ext();
begin
  v_s := pg_temp.mk_piece_in(p_shop, p_camp, p_anchor);
  perform analytics.content_gate_record(p_shop, v_s, 'fact_check', 'passed', 'owner', jsonb_build_object('sources', jsonb_build_array('https://example.com/a')));
  perform analytics.content_gate_record(p_shop, v_s, 'brand_rule', 'passed', 'owner');
  perform analytics.content_gate_record(p_shop, v_s, 'risk_owner', 'passed', 'owner');
  perform analytics.content_piece_advance(p_shop, v_s, 'approved', 'owner', null, 45);
  perform analytics.content_piece_advance(p_shop, v_s, 'produced', 'owner');
  select id into v_hook from analytics.content_hook where step_id = v_s and label = 'A';
  perform analytics.content_piece_post(p_shop, v_s, 'tiktok', v_ext, pg_temp.url(v_ext), now() - make_interval(days => 11 - p_idx), 'owner', v_hook, null, null, null);
  return v_s;
end $mpo$;

create or replace function pg_temp.mkord(p_shop uuid, p_channel uuid, p_day date) returns uuid
 language plpgsql as $mo$
declare v_id uuid;
begin
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (p_shop, 'QAR2-' || substr(gen_random_uuid()::text, 1, 12), p_channel, p_day, 100)
  returning id into v_id;
  return v_id;
end $mo$;

create or replace function pg_temp.csnap(p_camp uuid) returns text
 language sql as $cs$
  select md5(coalesce((select concat_ws('|', status, result_verdict, result_note, hypothesis, metric_code, baseline_value, baseline_spread, baseline_as_of,
                                          baseline_note, pass_threshold, pass_op, metric_channel_code, metric_affinity, metric_date_from, metric_date_to,
                                          result_verdict_proposed, result_proposed_note, result_proposed_at, result_proposed_by_role,
                                          result_verdict_confirmed_at, result_verdict_confirmed_by_role, lesson, result_open_pieces, updated_at)
                         from analytics.campaign where id = p_camp), ''))
$cs$;

create or replace function pg_temp.ctok(p_camp uuid) returns text
 language sql as $ct$ select analytics.campaign_verdict_token_(p_camp) $ct$;

-- true = tok ไม่ซ้ำกับของเดิมใน array (เทียบ text)
create or replace function pg_temp.fresh(p_prev text[], p_tok text) returns boolean
 language sql as $fr$ select p_tok is not null and p_tok <> all (p_prev) $fr$;

do $qar2$
declare
  v_log   text := E'\n=== qa-0162-round2 ===\n';
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_tz0   text := current_setting('TimeZone');
  v_ds0   text := current_setting('DateStyle');
  v_real  uuid;
  v_s     uuid;      -- ร้านหลักของไฟล์นี้
  v_s2    uuid;      -- ร้านที่สอง (ข้ามร้าน)
  v_ch    uuid;      -- line_oa
  v_n     bigint;
  v_n2    bigint;
  v_r     text;
  v_j     jsonb;
  v_j2    jsonb;
  v_c     uuid;
  v_c2    uuid;
  v_c3    uuid;
  v_step  uuid;
  v_step2 uuid;
  v_sum   uuid;
  v_id    uuid;
  v_id2   uuid;
  v_id3   uuid;
  v_o     uuid;
  v_tok   text;
  v_tok2  text;
  v_tok3  text;
  v_toks  text[];
  v_snap  text;
  v_fld   text;
  v_t     text;
  v_mon   date;
  v_i     int;
  v_bad   text;
  v_title text;
  v_fail  int;
  v_ok    int;
  r       record;
begin
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select count(*) into v_n from public.shop;
  if v_n <> 1 then raise exception 'qa-0162-round2: ต้องมีร้านเดียวใน public.shop (พบ %)', v_n; end if;
  select id into v_real from public.shop;
  select id into v_ch from analytics.dim_channel where code = 'line_oa';
  if v_ch is null then raise exception 'qa-0162-round2: ไม่มีช่องทาง line_oa'; end if;
  insert into public.shop (name) values ('qa-0162-r2 shop S') returning id into v_s;
  insert into public.shop (name) values ('qa-0162-r2 shop S2') returning id into v_s2;

  ----------------------------------------------------------------------------
  -- T1: ทุกฟิลด์ที่ควรอยู่ใน campaign token ขยับ token (กัน mutant "ลืมใส่ฟิลด์ใน tuple")
  --     แต่ละขั้น = เปลี่ยนฟิลด์เดียว · token ใหม่ต้องไม่ซ้ำกับทุก token ก่อนหน้า
  ----------------------------------------------------------------------------
  v_c := pg_temp.mk_camp(v_s, v_today + 20);
  v_toks := array[pg_temp.ctok(v_c)];
  v_log := v_log || pg_temp.vb('T1-0', 'token ของแคมเปญเริ่มต้นเป็น md5 32 ตัว', v_toks[1] ~ '^[0-9a-f]{32}$', coalesce(v_toks[1], 'null'));
  for r in
    select * from (values
      ('hypothesis',          '{"hypothesis":"สมมติฐาน ก"}'),
      ('hypothesis(ซ้ำคนละค่า)', '{"hypothesis":"สมมติฐาน ข"}'),
      ('metric_code',         '{"metric_code":"orders"}'),
      ('baseline_value',      '{"baseline_value":10}'),
      ('baseline_spread',     '{"baseline_spread":2}'),
      ('baseline_as_of',      format('{"baseline_as_of":"%s"}', v_today - 1)),
      ('baseline_note',       '{"baseline_note":"ฐานจากเดือนก่อน"}'),
      ('pass_threshold+op',   '{"pass_threshold":20,"pass_op":">="}'),
      ('pass_op เดี่ยว',      '{"pass_op":"<="}'),
      ('pass_threshold เดี่ยว', '{"pass_threshold":25}'),
      ('metric_channel_code', '{"metric_channel_code":"line_oa"}'),
      ('metric_affinity',     '{"metric_affinity":"bar"}'),
      ('metric_date_from+to', format('{"metric_date_from":"%s","metric_date_to":"%s"}', v_today + 21, v_today + 25)),
      ('metric_date_to เดี่ยว', format('{"metric_date_to":"%s"}', v_today + 26)),
      ('metric_date_from เดี่ยว', format('{"metric_date_from":"%s"}', v_today + 22))
    ) as t(fld, setj)
  loop
    v_r := pg_temp.vok(pg_temp.q_plan(v_s, v_c, r.setj, 'owner'));
    v_tok := pg_temp.ctok(v_c);
    v_log := v_log || pg_temp.vb('T1 ' || r.fld, 'owner แก้ฟิลด์เดียว → สำเร็จ + token ใหม่ไม่ซ้ำของเดิม', v_r = 'OK' and pg_temp.fresh(v_toks, v_tok), v_r);
    v_toks := v_toks || v_tok;
  end loop;
  -- ข้อเสนอ: verdict · note · role (เวลา now() คงที่ ⇒ แยกไม่ได้ในไฟล์นี้)
  v_r := pg_temp.vok(pg_temp.q_prop(v_s, v_c, 'inconclusive', 'หลักฐานชุดแรก', 'ai'));
  v_tok := pg_temp.ctok(v_c);
  v_log := v_log || pg_temp.vb('T1 propose ai', 'ai เสนอ inconclusive → token ใหม่', v_r = 'OK' and pg_temp.fresh(v_toks, v_tok), v_r);
  v_toks := v_toks || v_tok;
  v_r := pg_temp.vok(pg_temp.q_prop(v_s, v_c, 'inconclusive', 'หลักฐานชุดที่สอง', 'ai'));
  v_tok := pg_temp.ctok(v_c);
  v_log := v_log || pg_temp.vb('T1 propose note', 'ai เสนอ verdict เดิม แก้เฉพาะหลักฐาน → token ใหม่ (expected_proposed อย่างเดียวจับไม่ได้)', v_r = 'OK' and pg_temp.fresh(v_toks, v_tok), v_r);
  v_toks := v_toks || v_tok;
  v_r := pg_temp.vok(pg_temp.q_prop(v_s, v_c, 'inconclusive', 'หลักฐานชุดที่สอง', 'owner'));
  v_tok := pg_temp.ctok(v_c);
  v_log := v_log || pg_temp.vb('T1 propose role', 'เจ้าของเสนอ verdict+หลักฐานเดียวกับ ai (เปลี่ยนแค่ role ผู้เสนอ · now() เท่าเดิม) → token ใหม่', v_r = 'OK' and pg_temp.fresh(v_toks, v_tok), v_r);
  v_toks := v_toks || v_tok;
  v_r := pg_temp.vok(pg_temp.q_prop(v_s, v_c, 'not_measured', 'วัดไม่ได้เพราะไม่มีข้อมูล', 'owner'));
  v_tok := pg_temp.ctok(v_c);
  v_log := v_log || pg_temp.vb('T1 propose verdict', 'เจ้าของเปลี่ยน verdict → token ใหม่', v_r = 'OK' and pg_temp.fresh(v_toks, v_tok), v_r);
  v_toks := v_toks || v_tok;
  -- คำตัดสินที่ยืนยัน: verdict/confirmed_at → ยืนยันแล้ว token ต้องใหม่ · ยืนยันซ้ำแก้เฉพาะ note → ใหม่อีก
  v_j := pg_temp.vj(pg_temp.q_conf(v_s, v_c, 'not_measured', null, 'owner', 'บันทึกครั้งแรก', 'not_measured'));
  v_tok := pg_temp.ctok(v_c);
  v_log := v_log || pg_temp.vb('T1 confirm', 'เจ้าของยืนยัน → สำเร็จ + token ใหม่ (result_verdict/confirmed_at/note)', v_j ->> 'error' is null and pg_temp.fresh(v_toks, v_tok), coalesce(v_j ->> 'msg', ''));
  v_toks := v_toks || v_tok;
  v_j := pg_temp.vj(pg_temp.q_conf(v_s, v_c, 'not_measured', null, 'owner', 'บันทึกครั้งที่สอง', 'not_measured'));
  v_tok2 := pg_temp.ctok(v_c);
  v_log := v_log || pg_temp.vb('T1 re-confirm note', 'ยืนยันซ้ำ verdict เดิม แก้เฉพาะ result_note → token ใหม่', v_j ->> 'error' is null and pg_temp.fresh(v_toks, v_tok2), coalesce(v_j ->> 'msg', ''));
  v_toks := v_toks || v_tok2;
  -- ฟิลด์นอก token: ยืนยันซ้ำเปลี่ยนแค่บทเรียน → token เท่าเดิม (บทเรียนไม่ใช่เนื้อหาที่เจ้าของเห็นก่อนยืนยัน)
  v_j := pg_temp.vj(pg_temp.q_conf(v_s, v_c, 'not_measured', 'บทเรียนใหม่ที่ไม่อยู่ใน token', 'owner', 'บันทึกครั้งที่สอง', 'not_measured'));
  v_tok3 := pg_temp.ctok(v_c);
  v_log := v_log || pg_temp.vb('T1 lesson', 'เปลี่ยนแค่บทเรียน → ยืนยันซ้ำได้ · token เท่าเดิม (บทเรียนอยู่นอก token โดยออกแบบ)', v_j ->> 'error' is null and v_tok3 = v_tok2, coalesce(v_j ->> 'msg', ''));
  v_log := v_log || '[NOTE] T1 ฟิลด์ที่ไม่อยู่ใน token โดยตั้งใจ: lesson · status · updated_at · result_open_pieces · ชื่อแคมเปญ — ถ้า UI แสดง lesson ให้เจ้าของแก้แล้วเปลี่ยนกลางทาง CAS จะไม่จับ (ผลกระทบต่ำ: lesson เขียนผ่าน confirm เท่านั้น)' || E'\n';

  ----------------------------------------------------------------------------
  -- T2: token ต้องไม่ขึ้นกับ TimeZone / DateStyle ของ session (view กับ RPC คำนวณต่าง session กันได้)
  ----------------------------------------------------------------------------
  v_c2 := pg_temp.mk_camp(v_s, v_today + 20);
  perform pg_temp.vok(pg_temp.q_plan(v_s, v_c2, format('{"metric_code":"orders","baseline_as_of":"%s","metric_date_from":"%s","metric_date_to":"%s","pass_threshold":3,"pass_op":">="}', v_today - 2, v_today + 21, v_today + 23), 'owner'));
  perform pg_temp.vok(pg_temp.q_prop(v_s, v_c2, 'inconclusive', 'ยังไม่มีข้อมูล', 'ai'));
  v_t := pg_temp.ctok(v_c2);
  perform set_config('TimeZone', 'Pacific/Kiritimati', true);
  v_tok := pg_temp.ctok(v_c2);
  perform set_config('TimeZone', 'America/Los_Angeles', true);
  v_tok2 := pg_temp.ctok(v_c2);
  perform set_config('DateStyle', 'German, DMY', true);
  v_tok3 := pg_temp.ctok(v_c2);
  select s.verdict_token into v_r from analytics.v_campaign_summary s where s.campaign_id = v_c2;
  select i.content_token into v_bad from analytics.v_recommendation_inbox i where i.item_kind = 'campaign_verdict' and i.item_id = v_c2;
  perform set_config('TimeZone', v_tz0, true);
  perform set_config('DateStyle', v_ds0, true);
  v_log := v_log || pg_temp.vb('T2a', 'campaign token เท่ากันใน TimeZone +14 / -8 / Asia/Bangkok และ DateStyle German', v_t = v_tok and v_t = v_tok2 and v_t = v_tok3, concat_ws(' ', v_t, v_tok, v_tok2, v_tok3));
  v_log := v_log || pg_temp.vb('T2b', 'token จาก view (v_campaign_summary + inbox) ใน session TimeZone/DateStyle ต่างกัน = ค่าจากฟังก์ชัน', v_r = v_t and v_bad = v_t, concat_ws(' ', v_r, v_bad));
  -- confirm ผ่านด้วย token ที่ view อ่านใน session อื่น (เหมือนหน้าจออ่านด้วย TZ ของ client แล้วส่งกลับ)
  perform set_config('TimeZone', 'Pacific/Kiritimati', true);
  v_j := pg_temp.vj(format('select analytics.campaign_verdict_confirm(%L::uuid,%L::uuid,%L,%L,%L,%L,%L,%L)', v_s, v_c2, 'inconclusive', null, 'owner', null, 'inconclusive', v_r));
  perform set_config('TimeZone', v_tz0, true);
  v_log := v_log || pg_temp.vb('T2c', 'confirm ด้วย token ที่ view อ่านไว้ แล้วเรียก RPC ใน TimeZone อื่น → ผ่าน (ไม่ใช่ 55000 ปลอม)', v_j ->> 'error' is null, coalesce(v_j ->> 'msg', ''));

  ----------------------------------------------------------------------------
  -- T3: ฟิลด์นอก token ขยับแล้ว token ต้องเท่าเดิม (กันเจ้าของโดน "ข้อมูลเปลี่ยน" ปลอมจากงานบอร์ด)
  ----------------------------------------------------------------------------
  v_c3 := pg_temp.mk_camp(v_s, v_today + 20);
  perform pg_temp.vok(pg_temp.q_prop(v_s, v_c3, 'inconclusive', 'หลักฐานสำหรับ T3', 'ai'));
  v_t := pg_temp.ctok(v_c3);
  update analytics.campaign set status = 'active' where id = v_c3;
  v_tok := pg_temp.ctok(v_c3);
  update analytics.campaign set name = name || ' (แก้ชื่อ)' where id = v_c3;
  v_tok2 := pg_temp.ctok(v_c3);
  update analytics.campaign set updated_at = now() + interval '1 day' where id = v_c3;
  v_tok3 := pg_temp.ctok(v_c3);
  v_log := v_log || pg_temp.vb('T3a', 'แก้ status / ชื่อ / updated_at ของแคมเปญ → token ไม่เปลี่ยน', v_t = v_tok and v_t = v_tok2 and v_t = v_tok3, concat_ws(' ', v_t, v_tok, v_tok2, v_tok3));
  v_step := (select id from analytics.campaign_step where campaign_id = v_c3 limit 1);
  perform analytics.content_piece_advance(v_s, v_step, 'drafting', 'owner');
  v_log := v_log || pg_temp.vb('T3b', 'ชิ้นงานในแคมเปญเดินสถานะ (idea → drafting) → token ไม่เปลี่ยน', pg_temp.ctok(v_c3) = v_t, pg_temp.ctok(v_c3));

  ----------------------------------------------------------------------------
  -- T4: token ผิดทุกแบบ → ปฏิเสธ + แถวไม่ขยับ + ไม่สร้างสัญญาณ · แล้วของถูกต้องต้องผ่าน (ต้องไม่พัง)
  ----------------------------------------------------------------------------
  v_c := pg_temp.mk_camp(v_s, v_today + 20);
  perform pg_temp.vok(pg_temp.q_prop(v_s, v_c, 'inconclusive', 'หลักฐาน T4', 'ai'));
  v_tok := pg_temp.ctok(v_c);
  v_snap := pg_temp.csnap(v_c);
  v_c2 := pg_temp.mk_camp(v_s, v_today + 20);                 -- แคมเปญอื่นในร้านเดียวกัน (token ของจริงคนละค่า)
  perform pg_temp.vok(pg_temp.q_prop(v_s, v_c2, 'inconclusive', 'หลักฐานอีกแคมเปญ', 'ai'));
  v_tok2 := pg_temp.ctok(v_c2);
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, 'T4 reco สำหรับเทียบ token ข้ามชนิด', 'รายละเอียด', 'ai'));
  v_id := (v_j ->> 'id')::uuid;
  v_tok3 := analytics.recommendation_token_(v_id);
  v_log := v_log || pg_temp.vb('T4-0', 'fixture: token สามค่าต่างกัน (แคมเปญ A / แคมเปญ B / reco)', v_tok <> v_tok2 and v_tok <> v_tok3 and v_tok2 <> v_tok3, '');
  v_log := v_log || pg_temp.vl('T4a', 'token มีช่องว่างนำหน้า → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', ' ' || v_tok), array['22023']));
  v_log := v_log || pg_temp.vl('T4b', 'token มีช่องว่าง/ขึ้นบรรทัดท้าย → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', v_tok || E'\n'), array['22023']));
  v_log := v_log || pg_temp.vl('T4c', 'token ยาว 33 → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', v_tok || '0'), array['22023']));
  v_log := v_log || pg_temp.vl('T4d', 'token สั้น 31 → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', left(v_tok, 31)), array['22023']));
  if upper(v_tok) <> v_tok then
    v_log := v_log || pg_temp.vl('T4e', 'token ตัวพิมพ์ใหญ่ทั้งชุด → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', upper(v_tok)), array['22023']));
  else
    v_log := v_log || E'[SKIP] T4e token ไม่มีตัวอักษร a-f เลย (ตัวพิมพ์ใหญ่ = เดิม) ทดสอบไม่ได้รอบนี้\n';
  end if;
  v_log := v_log || pg_temp.vl('T4f', 'token = ข้อความ null → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', 'null'), array['22023']));
  v_log := v_log || pg_temp.vl('T4g', 'token = ข้อความว่าง → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', ''), array['22023']));
  v_log := v_log || pg_temp.vl('T4g2', 'token = SQL null → 22023', pg_temp.vx(format('select analytics.campaign_verdict_confirm(%L::uuid,%L::uuid,%L,%L,%L,%L,%L,null)', v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive'), array['22023']));
  v_log := v_log || pg_temp.vl('T4g3', 'ไม่ส่ง token เลย (ใช้ default) → 22023 ไม่ใช่ผ่านเงียบ', pg_temp.vx(format('select analytics.campaign_verdict_confirm(%L::uuid,%L::uuid,%L,%L,%L,%L,%L)', v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive'), array['22023']));
  v_log := v_log || pg_temp.vl('T4h', 'token ของแคมเปญอื่นในร้านเดียวกัน → 55000', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', v_tok2), array['55000'], 'เปลี่ยนแล้ว'));
  v_log := v_log || pg_temp.vl('T4i', 'token ของ reco (รูปถูก คนละชนิด) ส่งเข้า campaign confirm → 55000', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', v_tok3), array['55000']));
  v_log := v_log || pg_temp.vl('T4j', 'md5 ของสตริงว่าง (รูปถูก) → 55000', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', md5('')), array['55000']));
  v_log := v_log || pg_temp.vl('T4k', 'expected_proposed ตัวพิมพ์ต่าง (Inconclusive) → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'Inconclusive', v_tok), array['22023']));
  v_log := v_log || pg_temp.vl('T4l', 'expected_proposed = proposed:inconclusive (ค่าจาก verdict_display) → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'proposed:inconclusive', v_tok), array['22023']));
  v_log := v_log || pg_temp.vl('T4m', 'expected_proposed ถูกรูปแต่ผิดค่า (validated) + token ถูก → 55000 บอกค่าปัจจุบัน', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'validated', v_tok), array['55000'], 'inconclusive'));
  v_log := v_log || pg_temp.vl('T4n', 'expected_proposed = none ทั้งที่มีข้อเสนอ + token ถูก → 55000', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'none', v_tok), array['55000']));
  v_log := v_log || pg_temp.vl('T4o', 'actor ai ยืนยันด้วย token/expected ที่ถูกต้อง → ปฏิเสธ (AI ยืนยันแทนไม่ได้)', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'ai', null, 'inconclusive', v_tok), array['42501', '22023', '55000']));
  v_log := v_log || pg_temp.vl('T4p', 'actor system ยืนยัน → ปฏิเสธ', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'system', null, 'inconclusive', v_tok), array['42501', '22023', '55000']));
  v_log := v_log || pg_temp.vl('T4q', 'ร้านอื่นยืนยันแคมเปญของร้านนี้ (token ถูก) → ไม่พบแคมเปญในร้านนี้ 22023', pg_temp.vx(pg_temp.q_conf(v_s2, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', v_tok), array['22023'], 'ไม่พบแคมเปญ'));
  v_log := v_log || pg_temp.vb('T4z', 'ปฏิเสธทุกรอบแล้วแคมเปญไม่ขยับ · ไม่มีสัญญาณ insight', pg_temp.csnap(v_c) = v_snap
    and (select count(*) from analytics.content_signal where origin_campaign_id = v_c) = 0, '');
  v_log := v_log || pg_temp.vl('T4ok', 'ต้องไม่พัง: token ถูก + expected ถูก → ผ่าน', pg_temp.vok(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive', v_tok)));

  ----------------------------------------------------------------------------
  -- T5: เลียนแข่งกัน 2 ครั้ง — เจ้าของ 2 แท็บยืนยันด้วย token เดียวกัน: ตัวแรกชนะ ตัวหลังต้องแพ้ (for update + token ใหม่หลังตัวแรก)
  ----------------------------------------------------------------------------
  v_c := pg_temp.mk_camp(v_s, v_today + 20);
  perform pg_temp.vok(pg_temp.q_prop(v_s, v_c, 'inconclusive', 'หลักฐาน T5', 'ai'));
  v_tok := pg_temp.ctok(v_c);
  v_j := pg_temp.vj(pg_temp.q_conf(v_s, v_c, 'not_measured', 'บทเรียนแท็บ 1', 'owner', 'แท็บแรก', 'inconclusive', v_tok));
  v_log := v_log || pg_temp.vb('T5a', 'แท็บแรกยืนยัน not_measured ผ่าน', v_j ->> 'error' is null and v_j ->> 'verdict' = 'not_measured', coalesce(v_j ->> 'msg', ''));
  v_log := v_log || pg_temp.vl('T5b', 'แท็บสองยืนยัน inconclusive ด้วย token+expected ชุดเดิม → 55000', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', 'บทเรียนแท็บ 2', 'owner', 'แท็บสอง', 'inconclusive', v_tok), array['55000']));
  v_log := v_log || pg_temp.vb('T5c', 'คำตัดสินสุดท้าย = ของแท็บแรก · note/บทเรียนไม่ถูกแท็บสองทับ · สัญญาณมีแถวเดียว',
    (select result_verdict = 'not_measured' and result_note = 'แท็บแรก' and lesson = 'บทเรียนแท็บ 1' from analytics.campaign where id = v_c)
    and (select count(*) from analytics.content_signal where origin_campaign_id = v_c) = 1, '');
  v_j := pg_temp.vj(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', 'แท็บสองหลังรีเฟรช', 'inconclusive'));
  v_log := v_log || pg_temp.vb('T5e', 'เปลี่ยนใจด้วย token สด ผ่าน · previous_verdict = not_measured · บทเรียนเดิมคงอยู่ (ส่ง null)',
    v_j ->> 'error' is null and v_j ->> 'previous_verdict' = 'not_measured' and (v_j ->> 'lesson_kept')::boolean
    and (select lesson from analytics.campaign where id = v_c) = 'บทเรียนแท็บ 1', coalesce(v_j ->> 'msg', v_j::text));

  ----------------------------------------------------------------------------
  -- RT1: reco token — ทุกฟิลด์ที่ควรอยู่ใน token ขยับ token (แก้ตรงด้วย postgres บนแถว pending เหมือน MCP)
  ----------------------------------------------------------------------------
  v_c := pg_temp.mk_camp(v_s, v_today + 20);
  v_step := (select id from analytics.campaign_step where campaign_id = v_c limit 1);
  v_mon := v_today - (extract(isodow from v_today)::int - 1) - 7;
  v_j := pg_temp.vj(format('select analytics.content_weekly_summary_upsert(%L::uuid,%L::date,%L::date,%L::text[],%L,%L)', v_s, v_mon, v_mon, array['สรุปทดสอบ r2'], 'เนื้อหา Brief ทดสอบ r2', 'ai'));
  v_sum := (v_j ->> 'id')::uuid;
  v_log := v_log || pg_temp.vb('RT1-0', 'fixture: weekly summary สำหรับผูก reco', v_sum is not null, coalesce(v_j ->> 'msg', ''));
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, 'RT1 reco ทดสอบ token', 'รายละเอียดเดิม', 'ai'));
  v_id := (v_j ->> 'id')::uuid;
  v_toks := array[analytics.recommendation_token_(v_id)];
  for r in
    select * from (values
      ('title',          format('update analytics.recommendation_log set title = %L where id = %L', 'RT1 reco ทดสอบ token (แก้ชื่อ)', v_id)),
      ('detail',         format('update analytics.recommendation_log set detail = %L where id = %L', 'รายละเอียดใหม่', v_id)),
      ('kind',           format('update analytics.recommendation_log set kind = %L where id = %L', 'question', v_id)),
      ('source',         format('update analytics.recommendation_log set source = %L where id = %L', 'adhoc', v_id)),
      ('effort',         format('update analytics.recommendation_log set effort_minutes_est = 30 where id = %L', v_id)),
      ('respond_by+default', format('update analytics.recommendation_log set respond_by = %L::date, default_action = %L where id = %L', v_today + 5, 'ถือว่าปฏิเสธ', v_id)),
      ('default_action', format('update analytics.recommendation_log set default_action = %L where id = %L', 'ถือว่าอนุมัติ', v_id)),
      ('respond_by',     format('update analytics.recommendation_log set respond_by = %L::date where id = %L', v_today + 6, v_id)),
      ('related_campaign_id', format('update analytics.recommendation_log set related_campaign_id = %L where id = %L', v_c, v_id)),
      ('related_step_id', format('update analytics.recommendation_log set related_step_id = %L where id = %L', v_step, v_id)),
      ('summary_id',     format('update analytics.recommendation_log set summary_id = %L where id = %L', v_sum, v_id))
    ) as t(fld, sqlx)
  loop
    v_r := pg_temp.vok(r.sqlx);
    v_tok := analytics.recommendation_token_(v_id);
    v_log := v_log || pg_temp.vb('RT1 ' || r.fld, 'แก้ฟิลด์เดียวบนแถว pending → สำเร็จ + token ใหม่ไม่ซ้ำของเดิม', v_r = 'OK' and pg_temp.fresh(v_toks, v_tok), v_r);
    v_toks := v_toks || v_tok;
  end loop;
  -- ฟิลด์นอก token: outcome_note · updated_at
  v_tok := analytics.recommendation_token_(v_id);
  update analytics.recommendation_log set outcome_note = 'ผลที่ทีมจด' where id = v_id;
  v_log := v_log || pg_temp.vb('RT1 outcome_note', 'ทีมจด outcome_note → token ไม่เปลี่ยน (เจ้าของที่กำลังกรอกไม่ชน)', analytics.recommendation_token_(v_id) = v_tok, '');

  ----------------------------------------------------------------------------
  -- RT2: reco token ไม่ขึ้นกับ TimeZone · view = ฟังก์ชัน
  ----------------------------------------------------------------------------
  v_t := analytics.recommendation_token_(v_id);
  perform set_config('TimeZone', 'Pacific/Kiritimati', true);
  v_tok := analytics.recommendation_token_(v_id);
  select i.content_token into v_r from analytics.v_recommendation_inbox i where i.item_kind = 'reco' and i.item_id = v_id;
  perform set_config('TimeZone', v_tz0, true);
  v_log := v_log || pg_temp.vb('RT2', 'reco token เท่ากันใน TimeZone +14 และจาก view', v_t = v_tok and v_t = v_r, concat_ws(' ', v_t, v_tok, v_r));

  ----------------------------------------------------------------------------
  -- RT3/RT4: respond token ผิด/ข้ามชนิด/เก่า/null/'' · ตอบซ้ำ · ต้องไม่พัง
  ----------------------------------------------------------------------------
  v_snap := (select md5(concat_ws('|', owner_action, acted_at, owner_response, title, detail)) from analytics.recommendation_log where id = v_id);
  v_tok := analytics.recommendation_token_(v_id);
  v_c2 := pg_temp.mk_camp(v_s, v_today + 20);
  perform pg_temp.vok(pg_temp.q_prop(v_s, v_c2, 'inconclusive', 'หลักฐานเทียบ token ข้ามชนิด', 'ai'));
  v_log := v_log || pg_temp.vl('RT3a', 'respond ด้วย token ของแคมเปญ (ข้ามชนิด รูปถูก) → 55000', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'done', 'โอเค', 'owner', pg_temp.ctok(v_c2)), array['55000'], 'เปลี่ยนแล้ว'));
  v_log := v_log || pg_temp.vl('RT3b', 'respond token ก่อนแก้ detail (เก่า) → 55000', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'done', 'โอเค', 'owner', v_toks[2]), array['55000']));
  v_log := v_log || pg_temp.vl('RT3c', 'respond token = ว่าง → 22023', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'done', 'โอเค', 'owner', ''), array['22023']));
  v_log := v_log || pg_temp.vl('RT3d', 'respond token = SQL null → 22023', pg_temp.vx(format('select analytics.recommendation_respond(%L::uuid,%L::uuid,%L,%L,%L,null)', v_s, v_id, 'done', 'โอเค', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('RT3e', 'ไม่ส่ง token เลย → 22023', pg_temp.vx(format('select analytics.recommendation_respond(%L::uuid,%L::uuid,%L,%L,%L)', v_s, v_id, 'done', 'โอเค', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('RT3f', 'respond token ช่องว่างนำหน้า → 22023', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'done', 'โอเค', 'owner', ' ' || v_tok), array['22023']));
  v_log := v_log || pg_temp.vl('RT3g', 'ร้านอื่นตอบแถวของร้านนี้ (token ถูก) → ไม่พบข้อเสนอในร้านนี้', pg_temp.vx(pg_temp.q_rresp(v_s2, v_id, 'done', 'โอเค', 'owner', v_tok), array['22023'], 'ไม่พบข้อเสนอ'));
  v_log := v_log || pg_temp.vb('RT3z', 'ปฏิเสธทุกรอบแล้วแถวไม่ขยับ (ยัง pending · ไม่มีคำตอบ)',
    (select md5(concat_ws('|', owner_action, acted_at, owner_response, title, detail)) from analytics.recommendation_log where id = v_id) = v_snap
    and (select owner_action from analytics.recommendation_log where id = v_id) = 'pending', '');
  v_j := pg_temp.vj(pg_temp.q_rresp(v_s, v_id, 'done', 'ตกลงทำตามนี้', 'owner', v_tok));
  v_log := v_log || pg_temp.vb('RT4a', 'ต้องไม่พัง: respond ด้วย token สด ผ่าน · owner_response เก็บ · outcome_note ที่ทีมจดไว้ไม่หาย',
    v_j ->> 'error' is null and (select owner_response = 'ตกลงทำตามนี้' and outcome_note = 'ผลที่ทีมจด' and acted_by_role = 'owner' from analytics.recommendation_log where id = v_id), coalesce(v_j ->> 'msg', ''));
  v_log := v_log || pg_temp.vl('RT4b', 'ตอบซ้ำด้วย token เดิม (เจ้าของ 2 แท็บ) → 55000 ตอบแล้ว', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'rejected', 'เปลี่ยนใจ', 'owner', v_tok), array['55000'], 'ตอบแล้ว'));
  v_log := v_log || pg_temp.vl('RT4c', 'ตอบซ้ำด้วย token สดของแถวที่ตอบแล้ว → 55000 ตอบแล้ว (ล็อกจริง ไม่ใช่แค่ token)', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'rejected', 'เปลี่ยนใจ', 'owner'), array['55000'], 'ตอบแล้ว'));
  v_log := v_log || pg_temp.vb('RT4d', 'คำตอบแรกไม่ถูกทับ (done · ตกลงทำตามนี้)', (select owner_action = 'done' and owner_response = 'ตกลงทำตามนี้' from analytics.recommendation_log where id = v_id), '');

  ----------------------------------------------------------------------------
  -- C: recommendation_create
  ----------------------------------------------------------------------------
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, 'C1 ข้อเสนอแรก', 'รายละเอียดแรก', 'ai', 'proposal', 'agent', 15));
  v_log := v_log || pg_temp.vb('C1a', 'คืน jsonb object · key = id/created/conflict/expired_previous พอดี (ไม่มี key แอบแฝง · expired_previous เพิ่มรอบ 2 AG)',
    jsonb_typeof(v_j) = 'object' and (select array_agg(k order by k) from jsonb_object_keys(v_j) k) = array['conflict', 'created', 'expired_previous', 'id'], v_j::text);
  v_log := v_log || pg_temp.vb('C1b', 'ชนิดค่า: id เป็น uuid ที่มีอยู่จริง · created = true (boolean) · conflict = false (boolean)',
    jsonb_typeof(v_j -> 'created') = 'boolean' and jsonb_typeof(v_j -> 'conflict') = 'boolean' and (v_j ->> 'created')::boolean and not (v_j ->> 'conflict')::boolean
    and exists (select 1 from analytics.recommendation_log where id = (v_j ->> 'id')::uuid and shop_id = v_s and owner_action = 'pending'), v_j::text);
  v_id := (v_j ->> 'id')::uuid;

  -- C2 ชื่อซ้ำหลายแบบ → id เดิม created=false
  for r in
    select * from (values
      ('ชื่อเดียวกันเป๊ะ',    'C1 ข้อเสนอแรก'),
      ('ช่องว่างหน้าหลัง',    E'   C1 ข้อเสนอแรก  \t'),
      ('ช่องว่างซ้อนกลาง',    'C1   ข้อเสนอแรก'),
      ('ZWSP แทรก',           'C1 ข้อ' || chr(8203) || 'เสนอแรก'),
      ('ขึ้นบรรทัดใหม่แทนวรรค', E'C1\nข้อเสนอแรก')
    ) as t(what, ttl)
  loop
    v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, r.ttl, 'รายละเอียดแรก', 'ai', 'proposal', 'agent', 15));
    v_log := v_log || pg_temp.vb('C2 ' || r.what, 'ชื่อซ้ำแบบนี้ → id เดิม created=false conflict=false (ไม่ error · ไม่แถวคู่)',
      v_j ->> 'error' is null and (v_j ->> 'id')::uuid = v_id and not (v_j ->> 'created')::boolean and not (v_j ->> 'conflict')::boolean, v_j::text);
  end loop;
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, 'Weekly Brief Review ABC', 'รายละเอียดละติน', 'ai'));
  v_id2 := (v_j ->> 'id')::uuid;
  v_j2 := pg_temp.vj(pg_temp.q_rcreate(v_s, 'wEEKLY bRIEF rEVIEW abc', 'รายละเอียดละติน', 'system'));
  v_log := v_log || pg_temp.vb('C2 ละตินต่างตัวพิมพ์', 'ต่างแค่ตัวพิมพ์ + ต่าง actor → id เดิม · conflict=false (actor ไม่ใช่เนื้อหา)',
    (v_j2 ->> 'id')::uuid = v_id2 and not (v_j2 ->> 'created')::boolean and not (v_j2 ->> 'conflict')::boolean, v_j2::text);
  select count(*) into v_n from analytics.recommendation_log where shop_id = v_s and title ilike 'C1 %' or shop_id = v_s and title ilike 'weekly brief review abc';
  v_log := v_log || pg_temp.vb('C2z', 'หลังเรียกซ้ำทุกแบบ มีแถวเฉพาะ 2 แถว (C1 + Weekly)', v_n = 2, 'พบ ' || v_n);

  -- C3 ตอบแล้ว (done / rejected) → ชื่อเดิมสร้างใหม่ได้ (index เฉพาะ pending) และไม่ไปจับแถวที่ตอบแล้วเป็น "ซ้ำ"
  v_j := pg_temp.vj(pg_temp.q_rresp(v_s, v_id, 'done', 'ทำแล้ว', 'owner'));
  v_log := v_log || pg_temp.vb('C3-0', 'fixture: ตอบ C1 เป็น done', v_j ->> 'error' is null, coalesce(v_j ->> 'msg', ''));
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, 'C1 ข้อเสนอแรก', 'รายละเอียดรอบสอง', 'ai', 'proposal', 'agent', 15));
  v_id3 := (v_j ->> 'id')::uuid;
  v_log := v_log || pg_temp.vb('C3a', 'ชื่อเดิมที่ตอบ done แล้ว สร้างใหม่ได้ → id ใหม่ created=true (ไม่คืนแถวที่ตอบแล้ว)',
    v_j ->> 'error' is null and v_id3 <> v_id and (v_j ->> 'created')::boolean and not (v_j ->> 'conflict')::boolean, v_j::text);
  v_log := v_log || pg_temp.vb('C3b', 'แถวที่ตอบแล้วไม่ขยับ (done · ทำแล้ว · detail เดิม)', (select owner_action = 'done' and owner_response = 'ทำแล้ว' and detail = 'รายละเอียดแรก' from analytics.recommendation_log where id = v_id), '');
  v_j := pg_temp.vj(pg_temp.q_rresp(v_s, v_id3, 'rejected', 'ไม่เอาแล้ว', 'owner'));
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, 'C1 ข้อเสนอแรก', 'รอบสาม', 'ai'));
  v_log := v_log || pg_temp.vb('C3c', 'ตอบ rejected แล้วสร้างชื่อเดิมได้อีก → แถวที่ 3 · มี 3 แถวชื่อนี้ (done · rejected · pending)',
    v_j ->> 'error' is null and (v_j ->> 'created')::boolean
    and (select count(*) from analytics.recommendation_log where shop_id = v_s and title = 'C1 ข้อเสนอแรก') = 3
    and (select count(*) from analytics.recommendation_log where shop_id = v_s and title = 'C1 ข้อเสนอแรก' and owner_action = 'pending') = 1, v_j::text);

  -- C4 conflict ตามเนื้อหา (เทียบ detail/kind/effort/respond_by/default/ลิงก์ — ไม่เทียบ source/actor)
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, 'C4 ฐานเปรียบเทียบ', 'รายละเอียด C4', 'ai', 'proposal', 'agent', 20, (v_today + 10)::text, 'ถือว่าเลื่อน', v_c));
  v_id := (v_j ->> 'id')::uuid;
  for r in
    select * from (values
      ('เหมือนทุกอย่าง แต่ source ต่าง', 'รายละเอียด C4', 'proposal', 'weekly_brief', 20, (v_today + 10)::text, 'ถือว่าเลื่อน', v_c, false),
      ('detail ต่าง',           'รายละเอียดอื่น', 'proposal', 'agent', 20, (v_today + 10)::text, 'ถือว่าเลื่อน', v_c, true),
      ('kind ต่าง',             'รายละเอียด C4', 'question', 'agent', 20, (v_today + 10)::text, 'ถือว่าเลื่อน', v_c, true),
      ('effort ต่าง',           'รายละเอียด C4', 'proposal', 'agent', 25, (v_today + 10)::text, 'ถือว่าเลื่อน', v_c, true),
      ('effort หายไป (null)',   'รายละเอียด C4', 'proposal', 'agent', null, (v_today + 10)::text, 'ถือว่าเลื่อน', v_c, true),
      ('respond_by ต่าง',       'รายละเอียด C4', 'proposal', 'agent', 20, (v_today + 11)::text, 'ถือว่าเลื่อน', v_c, true),
      ('default_action ต่าง',   'รายละเอียด C4', 'proposal', 'agent', 20, (v_today + 10)::text, 'ถือว่าทำ', v_c, true),
      ('ลิงก์แคมเปญหายไป',      'รายละเอียด C4', 'proposal', 'agent', 20, (v_today + 10)::text, 'ถือว่าเลื่อน', null::uuid, true)
    ) as t(what, det, kind, src, eff, resp, def, camp, expect_conflict)
  loop
    v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, 'C4 ฐานเปรียบเทียบ', r.det, 'ai', r.kind, r.src, r.eff, r.resp, r.def, r.camp));
    v_log := v_log || pg_temp.vb('C4 ' || r.what, 'ชื่อซ้ำ → id เดิม created=false · conflict=' || r.expect_conflict,
      v_j ->> 'error' is null and (v_j ->> 'id')::uuid = v_id and not (v_j ->> 'created')::boolean and (v_j ->> 'conflict')::boolean = r.expect_conflict, v_j::text);
  end loop;
  v_log := v_log || pg_temp.vb('C4z', 'conflict ทั้งหมดไม่ทับแถวเดิม (detail/kind/effort/respond_by/default เหมือนตอนสร้าง)',
    (select detail = 'รายละเอียด C4' and kind = 'proposal' and effort_minutes_est = 20 and respond_by = v_today + 10 and default_action = 'ถือว่าเลื่อน' and source = 'agent'
       from analytics.recommendation_log where id = v_id), '');

  -- C5 เรียกซ้ำ 20 ครั้ง
  v_n := 0; v_n2 := 0;
  for v_i in 1..20 loop
    v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, 'C5 เรียกซ้ำ', 'รายละเอียด C5', 'ai'));
    if (v_j ->> 'created')::boolean then v_n := v_n + 1; end if;
    if v_j ->> 'error' is not null then v_n2 := v_n2 + 1; end if;
  end loop;
  v_log := v_log || pg_temp.vb('C5', 'เรียก create ซ้ำ 20 ครั้ง → created=true ครั้งเดียว · ไม่มี error · แถวเดียว', v_n = 1 and v_n2 = 0
    and (select count(*) from analytics.recommendation_log where shop_id = v_s and title = 'C5 เรียกซ้ำ') = 1, 'created ' || v_n || ' · error ' || v_n2);

  -- C6 ข้ามร้าน
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_s2, 'C5 เรียกซ้ำ', 'รายละเอียด C5', 'ai'));
  v_log := v_log || pg_temp.vb('C6', 'ร้านอื่นใช้ชื่อเดียวกันได้ (created=true · id ไม่ชนร้านแรก)',
    v_j ->> 'error' is null and (v_j ->> 'created')::boolean and (select shop_id from analytics.recommendation_log where id = (v_j ->> 'id')::uuid) = v_s2, v_j::text);

  -- C7 ขอบ
  v_log := v_log || pg_temp.vl('C7a', 'ชื่อ 200 ตัวอักษรผ่าน', pg_temp.vok(pg_temp.q_rcreate(v_s, repeat('ก', 200), 'x', 'ai')));
  v_log := v_log || pg_temp.vl('C7b', 'ชื่อ 201 ตัวอักษร → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, repeat('ก', 201), 'x', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('C7c', 'ชื่อ ZWSP/ช่องว่างล้วน → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, '  ' || chr(8203) || '  ', 'x', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('C7d', 'detail 4000 ตัวอักษรผ่าน', pg_temp.vok(pg_temp.q_rcreate(v_s, 'C7d detail 4000', repeat('ข', 4000), 'ai')));
  v_log := v_log || pg_temp.vl('C7e', 'detail 4001 → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7e detail 4001', repeat('ข', 4001), 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('C7f', 'detail ว่าง → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7f', '   ', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('C7g', 'effort 480 ผ่าน', pg_temp.vok(pg_temp.q_rcreate(v_s, 'C7g', 'x', 'ai', 'proposal', 'agent', 480)));
  v_log := v_log || pg_temp.vl('C7h', 'effort 481 → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7h', 'x', 'ai', 'proposal', 'agent', 481), array['22023']));
  v_log := v_log || pg_temp.vl('C7i', 'effort 0 → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7i', 'x', 'ai', 'proposal', 'agent', 0), array['22023']));
  v_log := v_log || pg_temp.vl('C7j', 'effort ติดลบ → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7j', 'x', 'ai', 'proposal', 'agent', -5), array['22023']));
  -- รอบ 2 (R-M4): เส้นตาย "วันนี้" เป็นของเจ้าของ — ai/system ต้องเหลือเวลา ≥ 2 วัน · owner ตั้งวันนี้ได้
  v_log := v_log || pg_temp.vl('C7k', 'ต้องไม่พัง: owner ตั้ง respond_by = วันนี้ (ไทย) + default ผ่าน', pg_temp.vok(pg_temp.q_rcreate(v_s, 'C7k', 'x', 'owner', 'proposal', 'adhoc', null, v_today::text, 'ถือว่าเลื่อน')));
  v_log := v_log || pg_temp.vl('C7k2', 'R-M4 ai ตั้ง respond_by = วันนี้ → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7k2', 'x', 'ai', 'proposal', 'agent', null, v_today::text, 'ถือว่าเลื่อน'), array['22023']));
  v_log := v_log || pg_temp.vl('C7k3', 'R-M4 ai ตั้ง respond_by = พรุ่งนี้ → 22023 · วันนี้+2 ผ่าน', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7k3', 'x', 'ai', 'proposal', 'agent', null, (v_today + 1)::text, 'ถือว่าเลื่อน'), array['22023'])
    || pg_temp.vok(pg_temp.q_rcreate(v_s, 'C7k4', 'x', 'ai', 'proposal', 'agent', null, (v_today + 2)::text, 'ถือว่าเลื่อน')));
  v_log := v_log || pg_temp.vl('C7l', 'respond_by = เมื่อวาน → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7l', 'x', 'ai', 'proposal', 'agent', null, (v_today - 1)::text, 'ถือว่าเลื่อน'), array['22023']));
  v_log := v_log || pg_temp.vl('C7m', 'respond_by = วันนี้+90 ผ่าน', pg_temp.vok(pg_temp.q_rcreate(v_s, 'C7m', 'x', 'ai', 'proposal', 'agent', null, (v_today + 90)::text, 'ถือว่าเลื่อน')));
  v_log := v_log || pg_temp.vl('C7n', 'respond_by = วันนี้+91 → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7n', 'x', 'ai', 'proposal', 'agent', null, (v_today + 91)::text, 'ถือว่าเลื่อน'), array['22023']));
  v_log := v_log || pg_temp.vl('C7o', 'respond_by = infinity → 22023 (ไม่ใช่ 22008/ผ่านเงียบ)', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7o', 'x', 'ai', 'proposal', 'agent', null, 'infinity', 'ถือว่าเลื่อน'), array['22023']));
  v_log := v_log || pg_temp.vl('C7p', 'มี respond_by แต่ไม่มี default_action → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7p', 'x', 'ai', 'proposal', 'agent', null, (v_today + 3)::text), array['22023']));
  v_log := v_log || pg_temp.vl('C7q', 'default_action ว่างหลัง clean + มี respond_by → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7q', 'x', 'ai', 'proposal', 'agent', null, (v_today + 3)::text, ' ' || chr(8203)), array['22023']));
  v_log := v_log || pg_temp.vl('C7r', 'มี default_action แต่ไม่มี respond_by → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7r', 'x', 'ai', 'proposal', 'agent', null, null, 'ถือว่าเลื่อน'), array['22023']));
  v_log := v_log || pg_temp.vl('C7s', 'ชื่อไทย + อีโมจิ ZWJ ครอบครัว ผ่าน (ZWJ ต้องไม่โดนปฏิเสธ)', pg_temp.vok(pg_temp.q_rcreate(v_s, '🎉 ข้อเสนอ 👨‍👩‍👧 ทดสอบ', 'detail 💎 ไทย', 'ai')));
  v_log := v_log || pg_temp.vl('C7t', 'ลิงก์ step ที่ไม่มีจริง → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C7t', 'x', 'ai', 'proposal', 'agent', null, null, null, null, gen_random_uuid()), array['22023']));
  v_log := v_log || pg_temp.vl('C7u', 'ลิงก์ campaign ของร้านอื่น → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s2, 'C7u', 'x', 'ai', 'proposal', 'agent', null, null, null, v_c), array['22023']));
  v_log := v_log || pg_temp.vl('C7v', 'ลิงก์ summary ของร้านอื่น → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s2, 'C7v', 'x', 'ai', 'proposal', 'agent', null, null, null, null, null, v_sum), array['22023']));

  -- C8 kind / source / actor
  v_log := v_log || pg_temp.vl('C8a', 'kind = risk_gate → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C8a', 'x', 'ai', 'risk_gate'), array['22023']));
  v_log := v_log || pg_temp.vl('C8b', 'kind = campaign_verdict → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C8b', 'x', 'ai', 'campaign_verdict'), array['22023']));
  v_log := v_log || pg_temp.vl('C8c', 'kind = null → 22023', pg_temp.vx(format('select analytics.recommendation_create(%L::uuid,%L,%L,%L,null)', v_s, 'C8c', 'x', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('C8d', 'source = manual → 22023', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C8d', 'x', 'ai', 'proposal', 'manual'), array['22023']));
  v_log := v_log || pg_temp.vl('C8e', 'actor = admin → ปฏิเสธ', pg_temp.vx(pg_temp.q_rcreate(v_s, 'C8e', 'x', 'admin'), array['22023', '42501']));
  v_log := v_log || pg_temp.vl('C8f', 'actor = null → ปฏิเสธ', pg_temp.vx(format('select analytics.recommendation_create(%L::uuid,%L,%L,null)', v_s, 'C8f', 'x'), array['22023', '42501']));
  v_log := v_log || pg_temp.vl('C8g', 'ต้องไม่พัง: actor owner/system + source weekly_brief/adhoc + kind question ผ่านครบ', pg_temp.vok(pg_temp.q_rcreate(v_s, 'C8g-1', 'x', 'owner', 'question', 'adhoc'))
    || pg_temp.vok(pg_temp.q_rcreate(v_s, 'C8g-2', 'x', 'system', 'proposal', 'weekly_brief')));

  -- C9 SQL injection ในชื่อ/detail เก็บเป็นข้อความธรรมดา
  v_title := $t$'; drop table analytics.recommendation_log; -- $t$;
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, v_title, $t$') ; delete from analytics.recommendation_log; --$t$, 'ai'));
  v_log := v_log || pg_temp.vb('C9', 'ชื่อ/detail ที่เป็น SQL ถูกเก็บเป็นข้อความ · ตารางยังอยู่ · แถวอื่นยังอยู่',
    v_j ->> 'error' is null and to_regclass('analytics.recommendation_log') is not null
    and (select count(*) from analytics.recommendation_log where shop_id = v_s) > 10, v_j::text);

  ----------------------------------------------------------------------------
  -- L: คำตอบเจ้าของล็อก · actor · action
  ----------------------------------------------------------------------------
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, 'L ข้อเสนอสำหรับทดสอบล็อก', 'รายละเอียด L', 'ai'));
  v_id := (v_j ->> 'id')::uuid;
  v_snap := (select md5(concat_ws('|', owner_action, acted_at, owner_response, acted_by_role)) from analytics.recommendation_log where id = v_id);
  v_log := v_log || pg_temp.vl('L2a', 'ai ตอบแทนเจ้าของ (token สด) → ปฏิเสธ', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'done', 'ai ตอบเอง', 'ai'), array['42501', '22023']));
  v_log := v_log || pg_temp.vl('L2b', 'system ตอบแทน → ปฏิเสธ', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'done', 'system ตอบเอง', 'system'), array['42501', '22023']));
  v_log := v_log || pg_temp.vl('L2c', 'actor null → ปฏิเสธ', pg_temp.vx(format('select analytics.recommendation_respond(%L::uuid,%L::uuid,%L,%L,null,%L)', v_s, v_id, 'done', 'x', analytics.recommendation_token_(v_id)), array['22023', '42501']));
  v_log := v_log || pg_temp.vl('L3a', 'action = expired → 22023', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'expired', 'หมดเวลา', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('L3b', 'action = pending → 22023', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'pending', 'รอ', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('L3c', 'action = DONE (ตัวพิมพ์ใหญ่) → 22023', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'DONE', 'x', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('L3d', 'action = null → 22023', pg_temp.vx(format('select analytics.recommendation_respond(%L::uuid,%L::uuid,null,%L,%L,%L)', v_s, v_id, 'x', 'owner', analytics.recommendation_token_(v_id)), array['22023']));
  v_log := v_log || pg_temp.vl('L4a', 'rejected ไม่มีเหตุผล (null) → 22023', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'rejected', null, 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('L4b', 'rejected เหตุผลว่าง → 22023', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'rejected', '   ', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('L4c', 'rejected เหตุผล 2 ตัวอักษร (ab) → 22023', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'rejected', 'ab', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('L4d', 'rejected เหตุผล ZWSP ล้วน → 22023', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'rejected', chr(8203) || chr(8203) || chr(8203), 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('L4e', 'คำตอบ 1001 ตัวอักษร → 22023', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'done', repeat('ก', 1001), 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('L4f', 'คำตอบมี [ต้องยืนยัน → 22023', pg_temp.vx(pg_temp.q_rresp(v_s, v_id, 'done', 'โอเค [ต้องยืนยัน — ยังไม่แน่ใจ]', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vb('L-z', 'ปฏิเสธทุกรอบแล้วแถวยัง pending · ไม่มี acted_*', (select md5(concat_ws('|', owner_action, acted_at, owner_response, acted_by_role)) from analytics.recommendation_log where id = v_id) = v_snap
    and (select owner_action = 'pending' from analytics.recommendation_log where id = v_id), '');
  v_log := v_log || pg_temp.vl('L4ok1', 'ต้องไม่พัง: done ไม่มีข้อความตอบ (null) ผ่าน', pg_temp.vok(pg_temp.q_rresp(v_s, v_id, 'done', null, 'owner')));
  v_log := v_log || pg_temp.vb('L4ok2', 'done ไม่มีข้อความ → owner_response เป็น null · acted_by_role = owner', (select owner_response is null and acted_by_role = 'owner' and owner_action = 'done' from analytics.recommendation_log where id = v_id), '');
  -- L1: แก้ย้อนหลังด้วย postgres (ตอบแล้ว) · ต้องปฏิเสธ แล้วคำตอบเดิมอยู่
  v_log := v_log || pg_temp.vl('L1a', 'postgres เปลี่ยน done → rejected บนแถวที่ตอบแล้ว → 55000', pg_temp.vx(format('update analytics.recommendation_log set owner_action = %L where id = %L', 'rejected', v_id), array['55000']));
  v_log := v_log || pg_temp.vl('L1b', 'postgres ย้อน owner_action กลับ pending (ปลดล็อก) → 55000', pg_temp.vx(format('update analytics.recommendation_log set owner_action = %L where id = %L', 'pending', v_id), array['55000']));
  v_log := v_log || pg_temp.vb('L1z', 'คำตอบเจ้าของยังเดิม (done · null)', (select owner_action = 'done' and owner_response is null from analytics.recommendation_log where id = v_id), '');
  -- 🔴 FINDING R2-1: recommendation_log_guard ล็อก UPDATE คำตอบเจ้าของแม้ postgres แต่ไม่ล็อก DELETE ของ postgres — เคสนี้ [FAIL] จนกว่าจะปิดช่อง (ดูรายงาน QA รอบ 2)
  v_log := v_log || pg_temp.vl('L1c', 'postgres ลบแถวที่เจ้าของตอบแล้ว → ปฏิเสธ (55000/42501)', pg_temp.vx(format('delete from analytics.recommendation_log where id = %L', v_id), array['55000', '42501']));
  -- L5 ตอบช้ากว่าเส้นตาย (ย้อนวัน respond_by ตรงด้วย postgres ก่อนตอบ — เหมือนเวลาผ่านไป)
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_s, 'L5 ตอบช้า', 'รายละเอียด L5', 'ai', 'proposal', 'agent', null, (v_today + 2)::text, 'ถือว่าปฏิเสธ'));
  v_id2 := (v_j ->> 'id')::uuid;
  update analytics.recommendation_log set respond_by = v_today - 2 where id = v_id2;
  select i.effective_action into v_r from analytics.v_recommendation_inbox i where i.item_kind = 'reco' and i.item_id = v_id2;
  v_log := v_log || pg_temp.vb('L5a', 'เกินเส้นตาย: inbox effective_action = expired (ยังไม่ mutate แถว owner_action = pending)',
    v_r = 'expired' and (select owner_action from analytics.recommendation_log where id = v_id2) = 'pending', coalesce(v_r, 'null'));
  v_j := pg_temp.vj(pg_temp.q_rresp(v_s, v_id2, 'done', 'ขอตอบช้า ทำเลย', 'owner'));
  v_log := v_log || pg_temp.vb('L5b', 'ต้องไม่พัง: เจ้าของตอบช้าได้ · late = true · was_expired = true · คำตอบจริงชนะค่าเริ่มต้น',
    v_j ->> 'error' is null and (v_j ->> 'late')::boolean and (v_j ->> 'was_expired')::boolean and v_j ->> 'owner_action' = 'done'
    and (select owner_action = 'done' and owner_response = 'ขอตอบช้า ทำเลย' from analytics.recommendation_log where id = v_id2), coalesce(v_j ->> 'msg', v_j::text));
  select i.effective_action, i.is_late into v_r, v_bad from analytics.v_recommendation_inbox i where i.item_kind = 'reco' and i.item_id = v_id2;
  v_log := v_log || pg_temp.vb('L5c', 'หลังตอบช้า inbox แสดง done (ไม่ใช่ expired) · is_late = true', v_r = 'done' and v_bad::boolean, coalesce(v_r, 'null') || '/' || coalesce(v_bad, 'null'));

  ----------------------------------------------------------------------------
  -- P: AI แก้แผนหลังเริ่ม
  ----------------------------------------------------------------------------
  -- P1: anchor ผ่านมาแล้ว แต่เจ้าของตั้งช่วงนับเป็นอนาคต (AI แก้ได้ก่อนช่วงนับเริ่ม) → AI ล้างวันเริ่มช่วงนับเพื่อให้ตกกลับไปใช้ anchor (ผ่านมาแล้ว) ห้าม
  v_c := pg_temp.mk_camp(v_s, v_today - 3);
  v_log := v_log || pg_temp.vl('P1-0', 'fixture: owner ตั้ง orders + ช่วงนับอนาคต (วันนี้+3..+5) บนแคมเปญที่ anchor ผ่านมา 3 วัน',
    pg_temp.vok(pg_temp.q_plan(v_s, v_c, format('{"metric_code":"orders","metric_date_from":"%s","metric_date_to":"%s"}', v_today + 3, v_today + 5), 'owner')));
  v_snap := pg_temp.csnap(v_c);
  -- รอบ 2 (R-M2a): วันเริ่ม = least(metric_date_from, anchor, วัน step แรก) ⇒ anchor ที่ผ่านมาแล้วนับว่าเริ่ม แม้ช่วงนับของเจ้าของเป็นอนาคต (P1a เดิมคาดว่าผ่าน — กลับเป็นปฏิเสธ)
  v_log := v_log || pg_temp.vl('P1a', 'R-M2a ai แก้สมมติฐาน (anchor ผ่านมาแล้ว แม้ช่วงนับเป็นอนาคต) → 42501 "เริ่มแล้ว"', pg_temp.vx(pg_temp.q_plan(v_s, v_c, '{"hypothesis":"AI เสนอสมมติฐานก่อนช่วงนับ"}', 'ai'), array['42501'], 'เริ่มแล้ว'));
  v_snap := pg_temp.csnap(v_c);
  v_log := v_log || pg_temp.vl('P1b', 'ai ล้างช่วงนับทั้งคู่ (null/null) → ตกไปใช้ anchor ที่ผ่านมาแล้ว → 42501', pg_temp.vx(pg_temp.q_plan(v_s, v_c, '{"metric_date_from":null,"metric_date_to":null}', 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('P1c', 'ai ย้ายช่วงนับถอยมาครอบวันนี้ (วันนี้..+5) → 42501', pg_temp.vx(pg_temp.q_plan(v_s, v_c, format('{"metric_date_from":"%s"}', v_today), 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('P1d', 'system ล้างเกณฑ์/ช่วงนับทั้งหมดในครั้งเดียว → 42501', pg_temp.vx(pg_temp.q_plan(v_s, v_c, '{"metric_date_from":null,"metric_date_to":null,"pass_threshold":null,"pass_op":null,"metric_code":null}', 'system'), array['42501']));
  v_log := v_log || pg_temp.vb('P1z', 'ปฏิเสธทุกรอบแล้วแคมเปญไม่ขยับ', pg_temp.csnap(v_c) = v_snap, '');
  v_log := v_log || pg_temp.vl('P1e', 'ต้องไม่พัง: เจ้าของล้างช่วงนับเองได้แม้เริ่มแล้ว', pg_temp.vok(pg_temp.q_plan(v_s, v_c, '{"metric_date_from":null,"metric_date_to":null}', 'owner')));
  -- P2: หลังเจ้าของเสนอเอง (ไม่ใช่ AI) AI/ระบบย้ายเกณฑ์ไม่ได้ แม้ anchor ยังเป็นอนาคต
  v_c := pg_temp.mk_camp(v_s, v_today + 15);
  perform pg_temp.vok(pg_temp.q_prop(v_s, v_c, 'not_measured', 'เจ้าของเสนอเอง', 'owner'));
  v_log := v_log || pg_temp.vl('P2a', 'ai แก้แผนหลังเจ้าของเสนอคำตัดสิน → 42501', pg_temp.vx(pg_temp.q_plan(v_s, v_c, '{"hypothesis":"ขยับเสาหลังเจ้าของเสนอ"}', 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('P2b', 'system แก้แผนหลังเจ้าของเสนอ → 42501', pg_temp.vx(pg_temp.q_plan(v_s, v_c, '{"hypothesis":"ขยับเสาหลังเจ้าของเสนอ"}', 'system'), array['42501']));
  v_log := v_log || pg_temp.vl('P2c', 'ai ทับข้อเสนอของเจ้าของ → 42501', pg_temp.vx(pg_temp.q_prop(v_s, v_c, 'inconclusive', 'ai ทับ', 'ai'), array['42501']));
  -- P3: ก่อนเริ่มแก้ได้ทั้ง 12 key รวดเดียว (ต้องไม่พัง)
  v_c := pg_temp.mk_camp(v_s, v_today + 15);
  v_log := v_log || pg_temp.vl('P3', 'ต้องไม่พัง: ai ตั้งแผนเต็ม 12 key ก่อนเริ่ม (anchor +15) ผ่านในคำสั่งเดียว',
    pg_temp.vok(pg_temp.q_plan(v_s, v_c, format('{"hypothesis":"AI สมมติฐาน","metric_code":"orders","baseline_value":8,"baseline_spread":1.5,"baseline_as_of":"%s","baseline_note":"ฐาน AI","pass_threshold":12,"pass_op":">=","metric_channel_code":"line_oa","metric_affinity":"jewelry","metric_date_from":"%s","metric_date_to":"%s"}', v_today - 1, v_today + 16, v_today + 20), 'ai')));
  v_log := v_log || pg_temp.vb('P3z', 'ค่าที่ตั้งครบ (คำนวณอิสระจากตาราง)', (select hypothesis = 'AI สมมติฐาน' and metric_code = 'orders' and baseline_value = 8 and baseline_spread = 1.5 and pass_threshold = 12 and pass_op = '>='
    and metric_channel_code = 'line_oa' and metric_affinity = 'jewelry' and metric_date_from = v_today + 16 and metric_date_to = v_today + 20 from analytics.campaign where id = v_c), '');

  ----------------------------------------------------------------------------
  -- D: คำตัดสิน orders ต้องข้อมูลครอบช่วง · ใช้ร้านแยกต่อสถานการณ์ (data_through เป็นต่อร้าน)
  ----------------------------------------------------------------------------
  declare
    v_sa uuid; v_sb uuid; v_sc uuid; v_sd uuid; v_se uuid; v_sf uuid; v_sh uuid;
    v_chh uuid; v_o2 uuid;
    v_wt date := v_today - 2;     -- วันสุดท้ายของช่วง
    v_wf date := v_today - 4;
    v_ca uuid; v_cb uuid; v_cc uuid; v_cd uuid; v_ce uuid; v_cf uuid; v_cg uuid;
    v_o1 uuid;
    v_set text := format('{"metric_code":"orders","metric_date_from":"%s","metric_date_to":"%s","pass_threshold":1,"pass_op":">="}', v_today - 4, v_today - 2);
  begin
    insert into public.shop (name) values ('qa-0162-r2 shop Da') returning id into v_sa;   -- ข้อมูลถึง wt-1 (ขาด 1 วัน)
    insert into public.shop (name) values ('qa-0162-r2 shop Db') returning id into v_sb;   -- ข้อมูลถึง wt พอดี
    insert into public.shop (name) values ('qa-0162-r2 shop Dc') returning id into v_sc;   -- ข้อมูลถึง wt+3 (ช่องทางอื่นหลังช่วง)
    insert into public.shop (name) values ('qa-0162-r2 shop Dd') returning id into v_sd;   -- ไม่มีออเดอร์เลย
    insert into public.shop (name) values ('qa-0162-r2 shop De') returning id into v_se;   -- ข้อมูลถึง wt แต่วันกลางช่วงว่าง
    insert into public.shop (name) values ('qa-0162-r2 shop Df') returning id into v_sf;   -- ข้อมูลหายหลังเสนอ
    insert into public.shop (name) values ('qa-0162-r2 shop Dh') returning id into v_sh;   -- ข้อมูลถึง wt+1 (ครอบแบบ strict — R-H1 รอบ 2)
    perform pg_temp.mkord(v_sa, v_ch, v_wf); perform pg_temp.mkord(v_sa, v_ch, v_today - 3);
    perform pg_temp.mkord(v_sb, v_ch, v_wf); perform pg_temp.mkord(v_sb, v_ch, v_wt);
    perform pg_temp.mkord(v_sh, v_ch, v_wf); perform pg_temp.mkord(v_sh, v_ch, v_wt); perform pg_temp.mkord(v_sh, v_ch, v_wt + 1);
    perform pg_temp.mkord(v_sc, v_ch, v_wf); perform pg_temp.mkord(v_sc, v_ch, v_today - 1); perform pg_temp.mkord(v_sc, (select id from analytics.dim_channel where code = 'tiktok'), v_today + 1);   -- R3-H1: ช่องหลัก (v_ch) ต้องมีข้อมูลหลังวันท้ายเอง (today-1 > wt) ไม่ใช่แค่ช่องอื่น
    perform pg_temp.mkord(v_se, v_ch, v_wf); perform pg_temp.mkord(v_se, v_ch, v_wt); perform pg_temp.mkord(v_se, v_ch, v_wt + 1);
    perform pg_temp.mkord(v_sf, v_ch, v_wt);
    v_o1 := pg_temp.mkord(v_sf, v_ch, v_wt + 1);   -- ออเดอร์ล่าสุดของร้าน Df (วันหลัง wt) — D8 ลบตัวนี้
    v_ca := pg_temp.mk_camp(v_sa, v_today - 5); v_cb := pg_temp.mk_camp(v_sb, v_today - 5); v_cc := pg_temp.mk_camp(v_sc, v_today - 5);
    v_cd := pg_temp.mk_camp(v_sd, v_today - 5); v_ce := pg_temp.mk_camp(v_se, v_today - 5); v_cf := pg_temp.mk_camp(v_sf, v_today - 5);
    v_chh := pg_temp.mk_camp(v_sh, v_today - 5);
    perform pg_temp.vok(pg_temp.q_plan(v_sh, v_chh, v_set, 'owner'));
    perform pg_temp.vok(pg_temp.q_plan(v_sa, v_ca, v_set, 'owner')); perform pg_temp.vok(pg_temp.q_plan(v_sb, v_cb, v_set, 'owner'));
    perform pg_temp.vok(pg_temp.q_plan(v_sc, v_cc, v_set, 'owner')); perform pg_temp.vok(pg_temp.q_plan(v_sd, v_cd, v_set, 'owner'));
    perform pg_temp.vok(pg_temp.q_plan(v_se, v_ce, v_set, 'owner')); perform pg_temp.vok(pg_temp.q_plan(v_sf, v_cf, v_set, 'owner'));

    -- D1 ขาด 1 วัน: ข้อมูลถึง wt-1
    select s.orders_data_through::text, s.orders_data_covers_window::text into v_t, v_r from analytics.v_campaign_summary s where s.campaign_id = v_ca;
    v_log := v_log || pg_temp.vb('D1-0', 'ข้อมูลร้านถึง wt-1: through = ' || (v_today - 3) || ' · covers_window = false', v_t = (v_today - 3)::text and v_r = 'false', coalesce(v_t, 'null') || '/' || coalesce(v_r, 'null'));
    v_log := v_log || pg_temp.vl('D1a', 'ai เสนอ validated เมื่อข้อมูลขาดไป 1 วัน → 55000', pg_temp.vx(pg_temp.q_prop(v_sa, v_ca, 'validated', 'ยอดผ่านเกณฑ์แล้ว', 'ai'), array['55000'], 'ยังไม่ครบช่วง'));
    v_log := v_log || pg_temp.vl('D1b', 'ai เสนอ invalidated เมื่อข้อมูลขาดไป 1 วัน → 55000 (ศูนย์ที่ยังไม่เข้า ≠ ล้มเหลว)', pg_temp.vx(pg_temp.q_prop(v_sa, v_ca, 'invalidated', 'ยอดไม่ถึงเกณฑ์', 'ai'), array['55000'], 'ยังไม่ครบช่วง'));
    v_log := v_log || pg_temp.vl('D1c', 'owner เสนอ validated เมื่อข้อมูลขาด 1 วัน → 55000 (ด่านเดียวกัน)', pg_temp.vx(pg_temp.q_prop(v_sa, v_ca, 'validated', 'ยอดผ่านเกณฑ์แล้ว', 'owner'), array['55000']));
    v_log := v_log || pg_temp.vl('D1d', 'ต้องไม่พัง: เสนอ inconclusive เมื่อข้อมูลขาด ผ่าน', pg_temp.vok(pg_temp.q_prop(v_sa, v_ca, 'inconclusive', 'ข้อมูลยังไม่ถึง รอ import', 'ai')));
    v_log := v_log || pg_temp.vl('D1e', 'owner ยืนยัน validated เมื่อข้อมูลขาด 1 วัน (token+expected ถูก) → 55000', pg_temp.vx(pg_temp.q_conf(v_sa, v_ca, 'validated', null, 'owner', null, 'inconclusive'), array['55000'], 'ยังไม่ครบช่วง'));
    v_log := v_log || pg_temp.vl('D1f', 'owner ยืนยัน invalidated เมื่อข้อมูลขาด 1 วัน → 55000', pg_temp.vx(pg_temp.q_conf(v_sa, v_ca, 'invalidated', null, 'owner', null, 'inconclusive'), array['55000'], 'ยังไม่ครบช่วง'));
    v_log := v_log || pg_temp.vl('D1g', 'ต้องไม่พัง: owner ยืนยัน not_measured เมื่อข้อมูลขาด ผ่าน', pg_temp.vok(pg_temp.q_conf(v_sa, v_ca, 'not_measured', null, 'owner', 'ปิดโดยไม่ฟันธง', 'inconclusive')));

    -- D2 (R-H1 รอบ 2: strict) ข้อมูลถึง wt พอดี = วันท้ายอาจเข้าบางส่วน ⇒ ไม่ครอบ · ข้อมูลถึง wt+1 (ร้าน Dh) ⇒ ครอบ
    select s.orders_data_covers_window::text into v_r from analytics.v_campaign_summary s where s.campaign_id = v_cb;
    v_log := v_log || pg_temp.vb('D2-0', 'R-H1 ข้อมูลถึง wt พอดี (ไม่มีข้อมูลวันหลัง): covers_window = false', v_r = 'false', coalesce(v_r, 'null'));
    v_log := v_log || pg_temp.vl('D2a0', 'R-H1 ai เสนอ validated เมื่อข้อมูลถึง wt พอดี → 55000', pg_temp.vx(pg_temp.q_prop(v_sb, v_cb, 'validated', 'ยอด 2 ผ่านเกณฑ์ 1', 'ai'), array['55000'], 'ยังไม่ครบช่วง'));
    select s.orders_data_covers_window::text into v_r from analytics.v_campaign_summary s where s.campaign_id = v_chh;
    v_log := v_log || pg_temp.vb('D2-1', 'ข้อมูลร้านถึง wt+1: covers_window = true', v_r = 'true', coalesce(v_r, 'null'));
    v_log := v_log || pg_temp.vl('D2a', 'ต้องไม่พัง: ai เสนอ validated เมื่อข้อมูลถึง wt+1 ผ่าน', pg_temp.vok(pg_temp.q_prop(v_sh, v_chh, 'validated', 'ยอด 2 ผ่านเกณฑ์ 1', 'ai')));
    v_log := v_log || pg_temp.vl('D2b', 'ต้องไม่พัง: ai เปลี่ยนเป็น invalidated (เสนอซ้ำ) ผ่านด่านข้อมูล', pg_temp.vok(pg_temp.q_prop(v_sh, v_chh, 'invalidated', 'เปลี่ยนความเห็น', 'ai')));
    v_log := v_log || pg_temp.vl('D2c', 'ต้องไม่พัง: owner ยืนยัน validated ผ่าน · payload orders.actual = 2 (ออเดอร์วัน wt+1 นอกช่วงไม่นับ) · threshold_met = true · data_covers_window = true',
      case when (pg_temp.vj(pg_temp.q_conf(v_sh, v_chh, 'validated', null, 'owner', null, 'invalidated')) #>> '{orders,actual}') = '2' then 'OK' else 'FAIL payload orders.actual ≠ 2' end);

    -- D3 ข้อมูลของร้านถึงหลัง wt ในช่องทางอื่น → ครอบ (data_through ไม่กรองช่องทาง)
    v_log := v_log || pg_temp.vl('D3', 'ต้องไม่พัง: ช่องหลักมีออเดอร์หลังวันท้าย (today-1) + ช่องอื่นมีวัน +1 ⇒ ร้านครอบช่วง → ai เสนอ invalidated ผ่าน (R3-H1: ช่องที่ไม่ใช่ช่องหลักไม่ต้องมีข้อมูลหลังวันท้าย)',
      pg_temp.vok(pg_temp.q_prop(v_sc, v_cc, 'invalidated', 'ยอดน้อยกว่าเกณฑ์', 'ai')));

    -- D4 ร้านไม่มีออเดอร์เลย
    v_log := v_log || pg_temp.vl('D4a', 'ร้านไม่มีออเดอร์เลย: ai เสนอ invalidated → 55000 ไม่มีข้อมูลเลย', pg_temp.vx(pg_temp.q_prop(v_sd, v_cd, 'invalidated', 'ยอดศูนย์', 'ai'), array['55000'], 'ไม่มีข้อมูลเลย'));
    v_log := v_log || pg_temp.vl('D4b', 'ร้านไม่มีออเดอร์เลย: owner เสนอ validated → 55000', pg_temp.vx(pg_temp.q_prop(v_sd, v_cd, 'validated', 'x ผ่าน', 'owner'), array['55000']));

    -- D5 วันกลางช่วงว่าง แต่ข้อมูลถึง wt → ครอบ (ข้อจำกัดที่รู้: ตรวจแค่ max วัน ไม่ตรวจความต่อเนื่อง)
    select s.orders_data_covers_window::text, s.orders_actual::text into v_r, v_t from analytics.v_campaign_summary s where s.campaign_id = v_ce;
    v_log := v_log || pg_temp.vb('D5', 'วันกลางช่วงไม่มีออเดอร์เลย (wf กับ wt มี · wf+1 ว่าง · ร้านมีข้อมูลวัน wt+1) → covers_window = true · actual 2', v_r = 'true' and v_t = '2', coalesce(v_r, 'null') || '/' || coalesce(v_t, 'null'));
    v_log := v_log || '[NOTE] D5 ด่าน SEC-H1 ตรวจแค่ "วันล่าสุดที่ร้านมีออเดอร์ ≥ วันสุดท้ายของช่วง" — ไม่ตรวจว่าทุกวันในช่วงมีข้อมูล · ถ้า import ไฟล์ข้ามเดือน/ขาดกลางทางแล้ววันถัดไปมีออเดอร์ ยอดวันที่ขาดอ่านเป็น 0 แล้วผ่านด่าน (ความเสี่ยงต่ำ-กลาง · ไม่ใช่บั๊กตามสเปกปัจจุบัน)' || E'\n';

    -- D6 ไม่ตั้งเกณฑ์ (threshold/op ว่าง) → ฟันธง validated ไม่ได้ · inconclusive ได้
    v_cg := pg_temp.mk_camp(v_sb, v_today - 5);
    perform pg_temp.vok(pg_temp.q_plan(v_sb, v_cg, format('{"metric_code":"orders","metric_date_from":"%s","metric_date_to":"%s"}', v_today - 4, v_today - 2), 'owner'));
    v_log := v_log || pg_temp.vl('D6a', 'orders ไม่มีเกณฑ์ผ่าน: ai เสนอ validated → 55000 ต้องตั้งเกณฑ์ก่อน', pg_temp.vx(pg_temp.q_prop(v_sb, v_cg, 'validated', 'ยอดดี', 'ai'), array['55000'], 'ยังไม่ได้ตั้งเกณฑ์'));
    v_log := v_log || pg_temp.vl('D6b', 'ต้องไม่พัง: เสนอ inconclusive ผ่าน', pg_temp.vok(pg_temp.q_prop(v_sb, v_cg, 'inconclusive', 'ยังไม่มีเกณฑ์', 'ai')));

    -- D7 เจ้าของขยายช่วงหลัง AI เสนอ: token เปลี่ยน → ต้องรีเฟรช · ตัดสินด้วย token สดต้องตกด่านข้อมูล
    v_log := v_log || pg_temp.vb('D7-0', 'fixture: ร้าน Dc (ข้อมูลถึง wt+3) มีข้อเสนอ invalidated ของ ai จาก D3', (select result_verdict_proposed from analytics.campaign where id = v_cc) = 'invalidated', '');
    v_tok := pg_temp.ctok(v_cc);
    v_log := v_log || pg_temp.vl('D7a', 'owner ขยายวันสิ้นสุดช่วงเป็นอีก 10 วันข้างหน้า (เกินข้อมูลร้าน)', pg_temp.vok(pg_temp.q_plan(v_sc, v_cc, format('{"metric_date_to":"%s"}', v_today + 10), 'owner')));
    v_log := v_log || pg_temp.vb('D7b', 'token เปลี่ยนหลังขยายช่วง (หน้าจอที่เปิดค้างต้องรีเฟรช)', pg_temp.ctok(v_cc) <> v_tok, '');
    v_log := v_log || pg_temp.vl('D7c', 'confirm ด้วย token เก่า → 55000 "ข้อมูลแคมเปญเปลี่ยนแล้ว"', pg_temp.vx(pg_temp.q_conf(v_sc, v_cc, 'invalidated', null, 'owner', null, 'invalidated', v_tok), array['55000'], 'เปลี่ยนแล้ว'));
    v_log := v_log || pg_temp.vl('D7d', 'confirm ด้วย token สด แต่ช่วงใหม่เกินข้อมูล → 55000 "ยังไม่ถึงวันสุดท้าย" (ด่านข้อมูลทำงานตอนยืนยันด้วย ไม่ใช่แค่ตอนเสนอ)', pg_temp.vx(pg_temp.q_conf(v_sc, v_cc, 'invalidated', null, 'owner', null, 'invalidated'), array['55000'], 'ยังไม่ครบช่วง'));
    v_log := v_log || pg_temp.vl('D7e', 'ต้องไม่พัง: confirm inconclusive ด้วย token สด ผ่าน', pg_temp.vok(pg_temp.q_conf(v_sc, v_cc, 'inconclusive', null, 'owner', 'ช่วงยังไม่จบ', 'invalidated')));

    -- D8 ข้อมูลหายหลัง AI เสนอ (ลบออเดอร์วัน wt ที่เป็นข้อมูลล่าสุด) → ตอนยืนยันต้องตกด่านใหม่
    perform pg_temp.vok(pg_temp.q_prop(v_sf, v_cf, 'validated', 'ยอด 1 ผ่านเกณฑ์ 1', 'ai'));
    v_log := v_log || pg_temp.vb('D8-0', 'fixture: ร้าน Df ai เสนอ validated ผ่านตอนข้อมูลถึง wt', (select result_verdict_proposed from analytics.campaign where id = v_cf) = 'validated', '');
    v_r := pg_temp.vok(format('delete from analytics.fact_order where id = %L', v_o1));
    if v_r = 'OK' then
      v_log := v_log || pg_temp.vl('D8a', 'ออเดอร์ล่าสุดของร้าน (วัน wt+1) ถูกลบหลังเสนอ ⇒ ข้อมูลถึงแค่ wt ไม่ครอบ → owner ยืนยัน validated → 55000 (ด่านคำนวณสด ไม่ cache ผลตอนเสนอ)', pg_temp.vx(pg_temp.q_conf(v_sf, v_cf, 'validated', null, 'owner', null, 'validated'), array['55000']));
    else
      v_log := v_log || '[SKIP] D8a ลบ fact_order ในทรานแซกชันไม่ได้ (' || v_r || ')' || E'\n';
    end if;
  end;

  ----------------------------------------------------------------------------
  -- Q: ปิดแคมเปญที่มีชิ้นค้าง (Q12)
  ----------------------------------------------------------------------------
  declare
    v_cq uuid; v_a uuid; v_b uuid; v_p uuid; v_i1 uuid; v_i2 uuid;
    v_before text; v_after text;
  begin
    v_cq := pg_temp.mk_camp(v_s, v_today - 8);                                     -- ชิ้น idea 1
    v_i1 := (select id from analytics.campaign_step where campaign_id = v_cq limit 1);
    v_a := pg_temp.mk_piece_in(v_s, v_cq, v_today - 8);                            -- in_review 1
    v_p := pg_temp.mk_posted_in(v_s, v_cq, v_today - 8, 1);                        -- posted 1
    select string_agg(id || ':' || piece_status, ',' order by id) into v_before from analytics.campaign_step where campaign_id = v_cq;
    perform pg_temp.vok(pg_temp.q_prop(v_s, v_cq, 'inconclusive', 'ปิดทั้งที่ยังมีชิ้นค้าง', 'ai'));
    v_j := pg_temp.vj(pg_temp.q_conf(v_s, v_cq, 'inconclusive', null, 'owner', 'ปิดก่อนครบ', 'inconclusive'));
    v_log := v_log || pg_temp.vb('Q1a', 'ปิดแคมเปญที่มีชิ้นค้าง 2 (planned + in_review) + posted 1 → ผ่าน (ไม่ปฏิเสธ) · open_pieces 2 · excluded_from_result 2',
      v_j ->> 'error' is null and (v_j ->> 'open_pieces')::int = 2 and (v_j ->> 'excluded_from_result')::int = 2, coalesce(v_j ->> 'msg', v_j::text));
    v_log := v_log || pg_temp.vb('Q1b', 'open_by_status = {planned:1, in_review:1} · status = done · result_open_pieces = 2 บันทึกในแถว',
      v_j -> 'open_by_status' = '{"planned": 1, "in_review": 1}'::jsonb and (select status = 'done' and result_open_pieces = 2 from analytics.campaign where id = v_cq), coalesce((v_j -> 'open_by_status')::text, 'null'));
    select string_agg(id || ':' || piece_status, ',' order by id) into v_after from analytics.campaign_step where campaign_id = v_cq;
    v_log := v_log || pg_temp.vb('Q1c', 'การปิดแคมเปญไม่แตะสถานะชิ้นงานเลย (ทุกชิ้นสถานะเดิม — ไม่ถูกยกเลิก/โพสต์แทน)', v_before = v_after, '');
    select s.stage, s.pieces_open::text into v_t, v_r from analytics.v_campaign_summary s where s.campaign_id = v_cq;
    v_log := v_log || pg_temp.vb('Q1d', 'v_campaign_summary: stage = closed · pieces_open ยัง 2 (ไม่ซ่อนชิ้นค้าง)', v_t = 'closed' and v_r = '2', coalesce(v_t, 'null') || '/' || coalesce(v_r, 'null'));
    -- Q2: ยกเลิกชิ้นค้าง 1 แล้วยืนยันซ้ำ → นับใหม่ = 1
    perform set_config('c2.piece_rpc', '1', true);
    update analytics.campaign_step set piece_status = 'cancelled' where id = v_i1;
    perform set_config('c2.piece_rpc', '', true);
    v_j := pg_temp.vj(pg_temp.q_conf(v_s, v_cq, 'inconclusive', null, 'owner', 'ปิดอีกรอบ', 'inconclusive'));
    v_log := v_log || pg_temp.vb('Q2', 'ยกเลิกชิ้นค้าง 1 แล้วยืนยันซ้ำ → open_pieces = 1 (นับใหม่ · ชิ้นยกเลิกไม่นับ) · result_open_pieces = 1',
      v_j ->> 'error' is null and (v_j ->> 'open_pieces')::int = 1 and (select result_open_pieces = 1 from analytics.campaign where id = v_cq), coalesce(v_j ->> 'msg', v_j::text));
    -- Q3: validated ปิดไม่ได้ถ้า posted ไม่ครบ 4 (save_rate) แม้ชิ้นค้างไม่มี
    v_c := pg_temp.mk_camp(v_s, v_today - 8);
    perform pg_temp.vok(pg_temp.q_plan(v_s, v_c, '{"metric_code":"save_rate"}', 'owner'));
    perform pg_temp.mk_posted_in(v_s, v_c, v_today - 8, 2);
    v_log := v_log || pg_temp.vl('Q3', 'save_rate: posted 1 ชิ้น (ไม่มี T+7) + ชิ้นค้าง → owner ยืนยัน validated → 55000 (ชิ้นค้างไม่นับเป็นหลักฐาน)', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'validated', null, 'owner', null, 'none'), array['55000'], 'ไม่ครบ'));
    v_log := v_log || pg_temp.vl('Q3b', 'ต้องไม่พัง: ยืนยัน not_measured บนแคมเปญเดียวกันผ่านแม้มีชิ้นค้าง', pg_temp.vok(pg_temp.q_conf(v_s, v_c, 'not_measured', null, 'owner', 'ปิดเพราะข้อมูลน้อย', 'none')));
  end;

  ----------------------------------------------------------------------------
  -- LE: บทเรียน
  ----------------------------------------------------------------------------
  v_c := pg_temp.mk_camp(v_s, v_today + 20);
  perform pg_temp.vok(pg_temp.q_prop(v_s, v_c, 'inconclusive', 'หลักฐาน LE', 'ai'));
  v_snap := pg_temp.csnap(v_c);
  v_log := v_log || pg_temp.vl('LE1', 'บทเรียน 301 ตัวอักษร → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', repeat('ก', 301), 'owner', null, 'inconclusive'), array['22023']));
  v_log := v_log || pg_temp.vl('LE2', 'บทเรียนมี [ต้องยืนยัน → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', 'บทเรียน [ต้องยืนยัน]', 'owner', null, 'inconclusive'), array['22023']));
  v_log := v_log || pg_temp.vl('LE3', 'บทเรียนมี soft hyphen (U+00AD — content_text_clean ไม่ลบ) → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', 'บทเรียน' || chr(173) || 'ซ่อน', 'owner', null, 'inconclusive'), array['22023']));
  v_log := v_log || pg_temp.vl('LE3b', 'บทเรียนมี Unicode Tag (U+E0041) → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', 'บทเรียน' || chr(917569), 'owner', null, 'inconclusive'), array['22023']));
  v_log := v_log || pg_temp.vl('LE3c', 'note ยืนยัน 1001 ตัวอักษร → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', repeat('ก', 1001), 'inconclusive'), array['22023']));
  v_log := v_log || pg_temp.vl('LE3d', 'verdict ผิด (maybe) → 22023', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'maybe', null, 'owner', null, 'inconclusive'), array['22023']));
  v_log := v_log || pg_temp.vl('LE3e', 'verdict null → 22023', pg_temp.vx(format('select analytics.campaign_verdict_confirm(%L::uuid,%L::uuid,null,null,%L,null,%L,%L)', v_s, v_c, 'owner', 'inconclusive', pg_temp.ctok(v_c)), array['22023']));
  v_log := v_log || pg_temp.vb('LE4', 'ปฏิเสธทุกรอบแล้วแคมเปญไม่ขยับ · ไม่มีสัญญาณ insight', pg_temp.csnap(v_c) = v_snap and (select count(*) from analytics.content_signal where origin_campaign_id = v_c) = 0, '');
  -- ล้มเพราะ token เก่าทั้งที่บทเรียนถูก → ไม่สร้างสัญญาณ (atomic)
  v_log := v_log || pg_temp.vl('LE5', 'บทเรียนถูกต้อง + token เก่า → 55000 · ไม่สร้างสัญญาณ · แถวไม่ขยับ', pg_temp.vx(pg_temp.q_conf(v_s, v_c, 'inconclusive', 'บทเรียนที่ถูกต้อง', 'owner', null, 'inconclusive', md5('stale')), array['55000']));
  v_log := v_log || pg_temp.vb('LE5z', 'หลังล้ม: ไม่มี signal · csnap เดิม', (select count(*) from analytics.content_signal where origin_campaign_id = v_c) = 0 and pg_temp.csnap(v_c) = v_snap, '');
  -- ขอบ 300: ก ×300 ผ่าน · อีโมจิ 150 ตัว (300 byte-ish แต่ 150 char) ผ่าน
  v_j := pg_temp.vj(pg_temp.q_conf(v_s, v_c, 'inconclusive', repeat('ก', 300), 'owner', null, 'inconclusive'));
  v_log := v_log || pg_temp.vb('LE6', 'ต้องไม่พัง: บทเรียน 300 ตัวอักษรไทยพอดี ผ่าน · signal 1 · lesson ยาว 300',
    v_j ->> 'error' is null and (select length(lesson) = 300 from analytics.campaign where id = v_c)
    and (select count(*) from analytics.content_signal where origin_campaign_id = v_c) = 1, coalesce(v_j ->> 'msg', v_j::text));
  v_j := pg_temp.vj(pg_temp.q_conf(v_s, v_c, 'inconclusive', repeat('💎', 150), 'owner', null, 'inconclusive'));
  v_log := v_log || pg_temp.vb('LE7', 'ต้องไม่พัง: บทเรียนอีโมจิ 150 ตัว (นับเป็นตัวอักษร ไม่ใช่ byte) ผ่าน · signal ใหม่ 1 (รวม 2)',
    v_j ->> 'error' is null and (select count(*) from analytics.content_signal where origin_campaign_id = v_c) = 2, coalesce(v_j ->> 'msg', v_j::text));
  v_j := pg_temp.vj(pg_temp.q_conf(v_s, v_c, 'inconclusive', null, 'owner', null, 'inconclusive'));
  v_log := v_log || pg_temp.vb('LE8', 'ส่ง null → คงบทเรียนเดิม (อีโมจิ 150) · lesson_kept = true · ไม่สร้างสัญญาณเพิ่ม',
    v_j ->> 'error' is null and (v_j ->> 'lesson_kept')::boolean and (select lesson = repeat('💎', 150) from analytics.campaign where id = v_c)
    and (select count(*) from analytics.content_signal where origin_campaign_id = v_c) = 2, coalesce(v_j ->> 'msg', v_j::text));

  -- LE3r: RLO (U+202E) ใน "บทเรียน" — content_text_clean ลบทิ้งก่อนตรวจ (ไม่ใช่ 22023) · ต้องไม่หลุดเข้า DB (trojan-source) · ใช้แคมเปญแยก เพราะผ่านแล้วปิดแคมเปญ
  v_c2 := pg_temp.mk_camp(v_s, v_today + 20);
  perform pg_temp.vok(pg_temp.q_prop(v_s, v_c2, 'inconclusive', 'หลักฐาน LE3r', 'ai'));
  v_j := pg_temp.vj(pg_temp.q_conf(v_s, v_c2, 'inconclusive', 'บทเรียน' || chr(8238) || 'ซ่อน', 'owner', null, 'inconclusive'));
  v_log := v_log || pg_temp.vb('LE3r', 'RLO ในบทเรียนถูก clean ทิ้ง: ผ่าน · lesson ที่เก็บ = บทเรียนซ่อน · ไม่มี U+202E ทั้งใน lesson และ content_signal.summary',
    v_j ->> 'error' is null and (select lesson = 'บทเรียนซ่อน' and position(chr(8238) in lesson) = 0 from analytics.campaign where id = v_c2)
    and (select count(*) from analytics.content_signal where origin_campaign_id = v_c2 and position(chr(8238) in summary) > 0) = 0, coalesce(v_j ->> 'msg', v_j::text));

  ----------------------------------------------------------------------------
  -- ที่ไม่ครอบ (บอกตรงๆ)
  ----------------------------------------------------------------------------
  v_log := v_log || E'[SKIP] แข่งกันจริง 2 connection (for update ของ campaign/reco · partial unique index ตอน create พร้อมกัน) — do-block เดียวจำลองไม่ได้ · T5/RT4 เลียนแบบลำดับ "ตัวแรกชนะ ตัวหลังแพ้" เท่านั้น\n';
  v_log := v_log || E'[SKIP] ฟิลด์เวลาใน token (result_proposed_at / confirmed_at / acted_at) — now() คงที่ในทรานแซกชัน ขยับไม่ได้ในไฟล์นี้\n';
  v_log := v_log || E'[SKIP] ด่านวันไทยช่วง 00:00-07:00 (UTC เป็นวันก่อน) — เปลี่ยน now() ในทรานแซกชันไม่ได้ · ตรวจแบบ static แล้ว (verify-0162 N18)\n';
  v_log := v_log || E'[SKIP] ทางเรียกผ่าน PostgREST/JWT จริง (authenticated/anon) — อยู่ใน verify-0162 Y23 · qa-0161-revoke-regression\n';

  exception when others then
    v_log := v_log || format(E'[FAIL] ABORT qa-0162-round2 หยุดกลางทาง sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;
  perform set_config('TimeZone', v_tz0, true);
  perform set_config('DateStyle', v_ds0, true);
  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_log := v_log || format(E'\n=== สรุป: [OK] %s · [FAIL] %s — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n', v_ok, v_fail);
  raise exception '%', v_log;
end;
$qar2$;
