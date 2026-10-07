-- scripts/verify/qa-0162-extra.sql  (QA R2-D2 · 7 ต.ค. 69 · เคส "ต้องไม่พัง" เสริม verify-0162 — ของใหม่ใส่ของเก่า/ข้อมูลจริง/ทางเขียนที่ใช้อยู่วันนี้)
--
-- self-rolling-back do-block (3j-migration-traps #11): ทุกเคสเก็บผลลง v_log แล้ว raise exception ปิดท้ายเสมอ ⇒ ROLLBACK ทั้งหมด · DB จริงไม่ขยับ
-- ที่ต่างจาก verify-0162: ไม่ใช้ร้านทดสอบ B/C/X — ใช้ "ร้านจริง + แคมเปญ 10.10 จริง (75a252d4…) + แถว recommendation_log จริง 12 แถว" (ทุกอย่างอยู่ในทรานแซกชันที่ rollback)
-- ทางแอป (RPC) รันภายใต้ `set local role service_role` จริง · ทางเขียน reco เดิม (Weekly Brief task / Tech Lead ผ่าน MCP) รันด้วย role ของ session (postgres)
--
-- รัน 2 โหมด แล้ว diff บรรทัด [SIG] — พิสูจน์ "ของเดิมเหมือนก่อน 0162" โดยไม่ต้องเชื่อความจำ:
--   ก่อน 0161/0162:  node scripts/run-sql.mjs scripts/verify/qa-0162-extra.sql                                   (เคสที่ต้องมี 0162 จะ [SKIP])
--   หลัง 0161+0162:  cat supabase/migrations/0161_*.sql supabase/migrations/0162_*.sql scripts/verify/qa-0162-extra.sql > tmp.sql && node scripts/run-sql.mjs tmp.sql
--   เทียบ:           diff <(grep '^\[SIG\]' ก่อน.txt) <(grep '^\[SIG\]' หลัง.txt)   ต้องไม่ต่าง (ผลออกทาง error message ของ run-sql)
-- [SIG] = ค่าที่ไม่ขึ้นกับ uuid/เวลาที่รัน · [NOTE] = ตัวเลข/พฤติกรรมที่ต้องรู้ (ไม่ใช่ pass/fail) · [SKIP] = พิสูจน์ในโหมดนี้ไม่ได้
-- ตัวเลขของจริงไม่ผูกจำนวนตายตัว (บทเรียน qa-0159/0160): เทียบกับการนับอิสระจากตารางดิบเสมอ
--
-- กลุ่มเคส:
--   A  ทางเขียน recommendation_log วันนี้ (Weekly Brief task SKILL.md ขั้น 4 · Tech Lead ปิดข้อเสนอ) ด้วย role postgres + ทางเรียก RPC ผ่าน MCP (ไม่มี JWT) + แถวจริง 12 แถวไม่ขยับ + v_recommendation_acceptance
--   B  หน้า calendar/copilot: v_campaign_board ด้วยรายการคอลัมน์จริงของแอป (CAMPAIGN_BOARD_SELECT) · campaign/step คอลัมน์เดิมไม่ขยับ · status เขียนผ่านทางเดิมได้
--   C  แคมเปญ 10.10 จริง: campaign_plan_set (orders · line_oa · bar · 7–10 ต.ค. · ฐาน 0.5 · เกณฑ์ ≥6) → v_campaign_summary เทียบนับอิสระจาก fact_order หลายช่วงวัน · วงจร propose → confirm
--   D  วงจร: ปิดขณะมีชิ้นค้าง (Q12) · AI เสนอ → inbox → เจ้าของยืนยัน · reco create → respond · หมดเวลา → expired + default_action · weekly summary ส่งซ้ำ/ทับ
--   E  v_recommendation_inbox กับข้อมูลจริง (12 reco · ด่านความเสี่ยง · แคมเปญรอยืนยัน) เทียบนับอิสระ + สัญญาคอลัมน์ 21 ตัว
--   R  ขีดจำกัดของ RPC เทียบ "ของจริงที่ Tech Lead ส่ง" (ความยาว title/detail ของ 12 reco จริง) — เนื้อหา Brief จริงทั้งฉบับอยู่ใน qa-0162-realbrief.mjs

-- ---------- helper ----------
create or replace function pg_temp.vb(p_id text, p_what text, p_cond boolean, p_detail text default '') returns text
 language sql as $vb$
  select '[' || case when p_cond is true then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what
         || case when p_detail <> '' then ' → ' || p_detail else '' end || E'\n'
$vb$;

create or replace function pg_temp.sig(p_id text, p_val text) returns text
 language sql as $sg$ select '[SIG] ' || p_id || '=' || coalesce(p_val, '<null>') || E'\n' $sg$;

create or replace function pg_temp.note(p_id text, p_val text) returns text
 language sql as $nt$ select '[NOTE] ' || p_id || ' ' || coalesce(p_val, '<null>') || E'\n' $nt$;

-- รัน SQL ที่คืนค่าเดียวภายใต้ role (null = role ของ session) · error → 'ERR:<sqlstate>:<msg>' · reset role ทุกทาง · error ถอยเฉพาะคำสั่งนั้น (subtransaction)
create or replace function pg_temp.vq(p_role text, p_sql text) returns text
 language plpgsql as $vq$
declare v_out text;
begin
  if p_role is not null then
    execute format('set local role %I', p_role);
  end if;
  begin
    if p_sql ~* '^[[:space:]]*(insert|update|delete)[[:space:]]' then
      execute p_sql;      -- DML ไม่คืนค่า (INTO ใช้ไม่ได้ = 42601)
      v_out := 'DML';
    else
      execute p_sql into v_out;
    end if;
  exception when others then
    if p_role is not null then execute 'reset role'; end if;
    return 'ERR:' || sqlstate || ':' || left(sqlerrm, 200);
  end;
  if p_role is not null then execute 'reset role'; end if;
  return coalesce(v_out, '<null>');
end $vq$;

-- ต้องถูกปฏิเสธด้วย sqlstate ที่ระบุ
create or replace function pg_temp.ex(p_role text, p_sql text, p_expect text[]) returns text
 language plpgsql as $ex$
declare r text;
begin
  r := pg_temp.vq(p_role, p_sql);
  if r like 'ERR:%' then
    if split_part(r, ':', 2) = any (p_expect) then return 'OK ' || left(r, 130); end if;
    return 'FAIL sqlstate ผิด (คาด ' || array_to_string(p_expect, '/') || ') ' || left(r, 200);
  end if;
  return 'FAIL ผ่านทั้งที่ควรปฏิเสธ → ' || left(r, 100);
end $ex$;

-- ต้องสำเร็จ
create or replace function pg_temp.ok(p_role text, p_sql text) returns text
 language plpgsql as $ok$
declare r text;
begin
  r := pg_temp.vq(p_role, p_sql);
  if r like 'ERR:%' then return 'FAIL ควรสำเร็จแต่ตก ' || left(r, 220); end if;
  return 'OK';
end $ok$;

create or replace function pg_temp.vj(p_role text, p_sql text) returns jsonb
 language plpgsql as $vj$
declare r text;
begin
  r := pg_temp.vq(p_role, p_sql);
  if r like 'ERR:%' then return jsonb_build_object('error', split_part(r, ':', 2), 'msg', r); end if;
  return r::jsonb;
exception when others then
  return jsonb_build_object('error', 'PARSE', 'msg', left(r, 200));
end $vj$;

create or replace function pg_temp.colsig(p_rel text, p_skip text[] default '{}') returns text
 language sql as $cs$
  select count(*)::text || ':' || md5(coalesce(string_agg(column_name || '/' || data_type, ',' order by ordinal_position), ''))
    from information_schema.columns where table_schema = 'analytics' and table_name = p_rel and column_name <> all (p_skip)
$cs$;

-- signature ของ query ใดๆ ภายใต้ role: จำนวนแถว : md5 ของข้อความแถว (เรียงข้อความ)
create or replace function pg_temp.qsig(p_role text, p_query text) returns text
 language sql as $qs$
  select pg_temp.vq(p_role, format('select count(*)::text || '':'' || md5(coalesce(string_agg(t::text, E''\n'' order by t::text), '''')) from (%s) t', p_query))
$qs$;

-- นับออเดอร์อิสระจาก fact_order (ไม่ผ่าน v_content_order_daily) · 'bar' = ออเดอร์ที่มีสินค้า category เงินแท่ง (วิธีเดียวกับ qa-0161-extra O6 ที่พิสูจน์แล้วว่าตรง view)
create or replace function pg_temp.ind(p_shop uuid, p_from date, p_to date, p_chan text, p_aff text) returns int
 language sql as $ind$
  select count(*)::int
    from analytics.fact_order fo join analytics.dim_channel dc on dc.id = fo.channel_id
   where fo.shop_id = p_shop and fo.order_date between p_from and p_to
     and (p_chan is null or dc.code = p_chan)
     and (p_aff = 'all'
          or (p_aff = 'bar' and exists (select 1 from analytics.fact_order_item fi join public.product p on p.id = fi.product_id
                                         where fi.fact_order_id = fo.id and p.category = 'เงินแท่ง')))
$ind$;

-- เรียก RPC (ภายใต้ service_role จริง · พารามิเตอร์ครบตาม signature ที่ lib/ จะใช้)
create or replace function pg_temp.q_plan(p_shop uuid, p_camp uuid, p_set text, p_role text) returns text
 language sql as $q$ select format('select analytics.campaign_plan_set(%L::uuid,%L::uuid,%L::jsonb,%L)::text', p_shop, p_camp, p_set, p_role) $q$;
create or replace function pg_temp.q_prop(p_shop uuid, p_camp uuid, p_verdict text, p_note text, p_role text) returns text
 language sql as $q$ select format('select analytics.campaign_verdict_propose(%L::uuid,%L::uuid,%L,%L,%L)::text', p_shop, p_camp, p_verdict, p_note, p_role) $q$;
-- 0162 รอบแก้ security: confirm ต้องส่ง p_expected_token (= v_campaign_summary.verdict_token) — 'auto' = อ่านจาก analytics.campaign_verdict_token_ ตอนรัน (เหมือนหน้าจอที่เพิ่งรีเฟรช)
create or replace function pg_temp.q_conf(p_shop uuid, p_camp uuid, p_verdict text, p_lesson text, p_role text, p_note text, p_exp text, p_tok text default 'auto') returns text
 language sql as $q$ select format('select analytics.campaign_verdict_confirm(%L::uuid,%L::uuid,%L,%L,%L,%L,%L,%s)::text', p_shop, p_camp, p_verdict, p_lesson, p_role, p_note, p_exp,
   case when p_tok = 'auto' then format('analytics.campaign_verdict_token_(%L::uuid)', p_camp) else format('%L', p_tok) end) $q$;
create or replace function pg_temp.q_rc(p_shop uuid, p_title text, p_detail text, p_role text, p_kind text default 'proposal', p_source text default 'agent',
                                        p_effort int default null, p_resp text default null, p_def text default null, p_camp text default null) returns text
 language sql as $q$
  select format('select analytics.recommendation_create(%L::uuid,%L,%L,%L,%L,%L,%L::int,%L::date,%L,%L::uuid)::text', p_shop, p_title, p_detail, p_role, p_kind, p_source, p_effort, p_resp, p_def, p_camp)
$q$;
create or replace function pg_temp.q_rr(p_shop uuid, p_id uuid, p_action text, p_resp text, p_role text, p_tok text default 'auto') returns text
 language sql as $q$ select format('select analytics.recommendation_respond(%L::uuid,%L::uuid,%L,%L,%L,%s)::text', p_shop, p_id, p_action, p_resp, p_role,
   case when p_tok = 'auto' then format('analytics.recommendation_token_(%L::uuid)', p_id) else format('%L', p_tok) end) $q$;
create or replace function pg_temp.q_ws(p_shop uuid, p_week date, p_brief date, p_lines text, p_body text, p_role text) returns text
 language sql as $q$ select format('select analytics.content_weekly_summary_upsert(%L::uuid,%L::date,%L::date,%L::text[],%L,%L)::text', p_shop, p_week, p_brief, p_lines, p_body, p_role) $q$;

-- ฟิกซ์เจอร์แคมเปญ/ชิ้นงานผ่าน RPC จริง (ลอกจาก verify-0162)
create or replace function pg_temp.mk_camp(p_shop uuid, p_anchor date) returns uuid
 language plpgsql as $mc$
declare v_s uuid;
begin
  v_s := analytics.content_piece_create(p_shop, 'qa-0162 camp ' || substr(gen_random_uuid()::text, 1, 8), 'short_clip', 'tiktok', 'jewelry_925', 'owner', p_anchor);
  return (select campaign_id from analytics.campaign_step where id = v_s);
end $mc$;

create or replace function pg_temp.mk_piece_in(p_shop uuid, p_camp uuid, p_anchor date) returns uuid
 language plpgsql as $mp$
declare v_s uuid; v_a uuid;
begin
  v_s := analytics.content_piece_create(p_shop, 'qa-0162 piece ' || substr(gen_random_uuid()::text, 1, 8), 'short_clip', 'tiktok', 'jewelry_925', 'owner', p_anchor, null, p_camp);
  perform analytics.content_piece_advance(p_shop, v_s, 'drafting', 'owner');
  select a.id into v_a from analytics.step_artifact a where a.step_id = v_s;
  perform analytics.content_hook_upsert(p_shop, v_s, 'A', 'qa hook A', 'question', null, 'owner', null);
  perform analytics.content_hook_upsert(p_shop, v_s, 'B', 'qa hook B', 'fact', null, 'owner', null);
  perform analytics.campaign_set_artifact_content(v_a, 'qa body',
    jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
                       'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'ถ่ายหน้าโต๊ะ'), jsonb_build_object('id', 's2', 'desc', 'ใกล้ๆ'))));
  perform analytics.content_piece_advance(p_shop, v_s, 'in_review', 'owner');
  return v_s;
end $mp$;

create or replace function pg_temp.mk_posted_in(p_shop uuid, p_camp uuid, p_anchor date) returns uuid
 language plpgsql as $mpo$
declare v_s uuid; v_hook uuid; v_ext text := 'qa162-' || substr(gen_random_uuid()::text, 1, 12);
begin
  v_s := pg_temp.mk_piece_in(p_shop, p_camp, p_anchor);
  perform analytics.content_gate_record(p_shop, v_s, 'fact_check', 'passed', 'owner', jsonb_build_object('sources', jsonb_build_array('https://example.com/qa162')));
  perform analytics.content_gate_record(p_shop, v_s, 'brand_rule', 'passed', 'owner');
  perform analytics.content_gate_record(p_shop, v_s, 'risk_owner', 'passed', 'owner');
  perform analytics.content_piece_advance(p_shop, v_s, 'approved', 'owner', null, 45);
  perform analytics.content_piece_advance(p_shop, v_s, 'produced', 'owner');
  select id into v_hook from analytics.content_hook where step_id = v_s and label = 'A';
  perform analytics.content_piece_post(p_shop, v_s, 'tiktok', v_ext, 'https://www.tiktok.com/@qa0162/video/' || v_ext, now() - interval '2 days', 'owner', v_hook, null, null, null);
  return v_s;
end $mpo$;

-- ภาพรวมแถว reco จริง (ค่าเสถียร: id/เวลาของแถวจริงไม่เปลี่ยนระหว่างรัน — ใช้เทียบก่อน/หลัง apply ได้)
create or replace function pg_temp.rsnap() returns text
 language sql as $rs$
  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, shop_id, source, title, detail, owner_action, coalesce(effort_minutes_est::text, '~'),
                                                                  coalesce(related_campaign_id::text, '~'), coalesce(acted_at::text, '~'), coalesce(acted_by::text, '~'),
                                                                  coalesce(outcome_note, '~'), created_at, updated_at), E'\n' order by id), ''))
    from analytics.recommendation_log
$rs$;

do $qa0162$
declare
  c_camp    constant uuid := '75a252d4-6de4-4c07-81d0-aa712098bca2';   -- แคมเปญ 10.10 (id จาก brief)
  c_board   constant text := 'step_id, campaign_id, campaign_name, campaign_type, trigger_kind, anchor_date, seq, step_kind, resolved_start, resolved_end, days_until, audience_segment, audience_live_count, channel, goal_kpi, step_status, step_blocked_reason, artifacts, art_total, art_done, gates, effective_status, step_title, source_reco_key, start_time, step_origin, content_type_code';
  c_new_cmp constant text[] := array['metric_code', 'baseline_value', 'baseline_spread', 'baseline_as_of', 'baseline_note', 'pass_threshold', 'pass_op', 'metric_channel_code',
                                     'metric_affinity', 'metric_date_from', 'metric_date_to', 'result_verdict_proposed', 'result_proposed_note', 'result_proposed_at',
                                     'result_proposed_by_role', 'result_verdict_confirmed_at', 'result_verdict_confirmed_by_role', 'lesson', 'result_open_pieces'];
  v_log     text := E'\n=== qa-0162-extra ===\n';
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_has162  boolean := to_regprocedure('analytics.campaign_plan_set(uuid,uuid,jsonb,text)') is not null;
  v_shop    uuid;
  v_n       bigint;
  v_n2      bigint;
  v_n3      bigint;
  v_t       text;
  v_t2      text;
  v_j       jsonb;
  v_j2      jsonb;
  v_id      uuid;
  v_id2     uuid;
  v_snap0   text;
  v_snap1   text;
  v_acc0    text;
  v_acc1    text;
  v_board0  text;
  v_board1  text;
  v_c10     boolean;   -- ตัวแปรชั่วคราว (boolean)
  v_has10   boolean;   -- มีแคมเปญ 10.10 ในร้านจริงหรือไม่
  v_open10  int;       -- จำนวนชิ้นค้างจริงของ 10.10
  v_through date;
  v_thr_shop date;
  v_thr_chan date;   -- R-H1 รอบ 2: วันล่าสุดของช่อง line_oa (แคมเปญ 10.10 นับ line_oa)
  v_prop    text;
  v_actual  int;
  v_ind     int;
  v_w_from  date;
  v_w_to    date;
  v_camp    uuid;
  v_s1      uuid;
  v_s2      uuid;
  v_s3      uuid;
  v_mon     date;
  v_rev     int;
  v_upd     timestamptz;
  v_pend0   bigint;
  v_t0      timestamptz;
  v_ms      numeric;
  v_cols    text;
  r         record;
  v_fail    int;
  v_ok      int;
begin
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select count(*) into v_n from public.shop;
  if v_n <> 1 then raise exception 'qa-0162: ต้องมีร้านเดียวใน public.shop (พบ %)', v_n; end if;
  select id into v_shop from public.shop;
  select exists (select 1 from analytics.campaign where id = c_camp and shop_id = v_shop) into v_has10;
  v_log := v_log || pg_temp.note('MODE', case when v_has162 then 'หลัง 0161+0162 (มี campaign_plan_set)' else 'ก่อน 0162 (เคสที่ต้องมี 0162 = SKIP · ที่เหลือเป็น baseline [SIG])' end);
  v_log := v_log || pg_temp.note('ENV', format('current_user=%s · วันไทย=%s · แคมเปญ 10.10 %s', current_user, v_today, case when v_has10 then 'มี' else 'ไม่มี' end));

  ----------------------------------------------------------------------------
  -- A. ทางเขียน recommendation_log ที่ใช้อยู่วันนี้ (Weekly Brief task = INSERT ด้วย role ของ session · Tech Lead ปิดข้อเสนอด้วย UPDATE)
  --    คอลัมน์ที่ task เขียน (SKILL.md ขั้น 4): shop_id · source='weekly_brief' · title · detail · effort_minutes_est · related_campaign_id
  ----------------------------------------------------------------------------
  v_log := v_log || pg_temp.vb('A0', 'session รันด้วยสิทธิ์เจ้าของตาราง (postgres/superuser) เหมือน MCP ของ Tech Lead — ไม่ใช่ service_role', current_user in ('postgres', 'supabase_admin'), current_user);
  v_snap0 := pg_temp.rsnap();
  v_log := v_log || pg_temp.sig('A1.real_reco_rows', v_snap0);
  select count(*) into v_pend0 from analytics.recommendation_log where owner_action = 'pending';
  v_acc0 := pg_temp.qsig('service_role', 'select shop_id, month, source, done_count, rejected_count, expired_count, pending_count, total_count, acceptance_rate from analytics.v_recommendation_acceptance');
  v_log := v_log || pg_temp.sig('A2.acceptance_rows', v_acc0);
  -- นับอิสระของ v_recommendation_acceptance (สูตร 0101: ≠pending → action · pending เกิน 14 วัน → expired · ที่เหลือ pending) แยกเดือนไทย × source
  select count(*) into v_n from (
    select shop_id, (date_trunc('month', created_at at time zone 'Asia/Bangkok'))::date m, source,
           count(*) filter (where owner_action = 'done') d, count(*) filter (where owner_action = 'rejected') rj,
           count(*) filter (where owner_action = 'expired' or (owner_action = 'pending' and now() - created_at > interval '14 days')) ex,
           count(*) filter (where owner_action = 'pending' and now() - created_at <= interval '14 days') pd, count(*) tot
      from analytics.recommendation_log group by 1, 2, 3
    except
    select shop_id, month, source, done_count, rejected_count, expired_count, pending_count, total_count from analytics.v_recommendation_acceptance) z;
  v_log := v_log || pg_temp.vb('A2b', 'v_recommendation_acceptance = การนับอิสระจาก recommendation_log ทุกกลุ่ม (เดือน×source) — แถวที่ต่าง = 0', v_n = 0, 'ต่าง ' || v_n);

  -- A3: INSERT แบบที่ Weekly Brief task ทำ (แถวเดียว) — ต้องผ่านทั้งก่อน/หลัง 0162
  v_t := pg_temp.ok(null, format($i$insert into analytics.recommendation_log (shop_id, source, title, detail, effort_minutes_est, related_campaign_id)
      values (%L, 'weekly_brief', 'R90 · ทดสอบ QA ข้อเสนอจาก Brief 😀', E'owner_action: ตอบ ok\nconfidence: medium\nexpected: +3 ออเดอร์\nทบทวน: 14 ต.ค.', 10, %L)$i$, v_shop, case when v_has10 then c_camp::text else null end));
  v_log := v_log || pg_temp.vb('A3', 'INSERT แบบ Weekly Brief task (6 คอลัมน์ · ภาษาไทย/emoji/หลายบรรทัด) ผ่านด้วย role ของ session', v_t = 'OK', v_t);
  v_log := v_log || pg_temp.sig('A3.rowcount_delta', ((select count(*) from analytics.recommendation_log) - (select count(*) from analytics.recommendation_log where title not like 'R90 %'))::text);
  select * into r from analytics.recommendation_log where title like 'R90 %';
  v_log := v_log || pg_temp.vb('A3b', 'แถวใหม่: owner_action=pending · acted_at null · detail คงบรรทัดใหม่ (ไม่ถูกยุบ) · effort 10 · created_by_role null (ทางเดิมไม่ส่ง role)',
    r.owner_action = 'pending' and r.acted_at is null and position(E'\n' in r.detail) > 0 and r.effort_minutes_est = 10 and r.created_at is not null, left(r.detail, 40));
  if v_has162 then
    execute 'select kind, respond_by, default_action, created_by_role, acted_by_role, summary_id, related_step_id from analytics.recommendation_log where title like ''R90 %''' into r;
    v_log := v_log || pg_temp.vb('A3c', 'คอลัมน์ใหม่ของแถวจากทางเดิม: kind=proposal · respond_by/default_action/role/summary/step ว่าง', r.kind = 'proposal' and r.respond_by is null and r.default_action is null
      and r.created_by_role is null and r.acted_by_role is null and r.summary_id is null and r.related_step_id is null, '');
  end if;
  -- A4: หลายแถวในคำสั่งเดียว (task ลง ≤3 แถว)
  v_t := pg_temp.ok(null, format($i$insert into analytics.recommendation_log (shop_id, source, title, detail, effort_minutes_est, related_campaign_id) values
      (%1$L, 'weekly_brief', 'R91 · ทดสอบ 1', 'รายละเอียด 1', 5, null), (%1$L, 'weekly_brief', 'R92 · ทดสอบ 2', 'รายละเอียด 2', 3, null), (%1$L, 'weekly_brief', 'R93 · ทดสอบ 3', 'รายละเอียด 3', 12, null)$i$, v_shop));
  v_log := v_log || pg_temp.vb('A4', 'INSERT 3 แถวในคำสั่งเดียว (เพดาน ≤3 ข้อ/ฉบับ) ผ่าน', v_t = 'OK', v_t);
  -- A5: ชื่อซ้ำที่ยังรอตอบ — 0162 ตั้งใจให้ตก (partial unique) แม้ role postgres · ก่อน 0162 ผ่านเงียบ (นี่คือ "พฤติกรรมที่เปลี่ยน" ที่ Brief ต้องรู้)
  v_t := pg_temp.vq(null, format($i$with x as (insert into analytics.recommendation_log (shop_id, source, title, detail) values (%L, 'weekly_brief', '  r90 · ทดสอบ QA ข้อเสนอจาก Brief 😀 ', 'ซ้ำ') returning id) select count(*)::text from x$i$, v_shop));
  if v_has162 then
    v_log := v_log || pg_temp.vb('A5', 'ชื่อซ้ำ (ต่างตัวพิมพ์/ช่องว่างหัวท้าย) ขณะแถวแรกยัง pending → 23505 แม้ใช้ role postgres (index กันซ้ำระดับตาราง)', v_t like 'ERR:23505%', left(v_t, 90));
  else
    v_log := v_log || pg_temp.note('A5', 'ก่อน 0162 ชื่อซ้ำผ่านได้ (ผล=' || left(v_t, 20) || ') — หลัง 0162 จะตก 23505: Brief ที่รันซ้ำ/ลงชื่อเดิมจะได้ error ต้องจัดการ');
  end if;
  -- A6: ปิดข้อเสนอเก่า "แบบ Tech Lead ทำจริง" บนแถวจริง (R7 → rejected ยกระดับเป็น R10) ด้วย UPDATE ตรง
  select id into v_id from analytics.recommendation_log where title like 'R7 %' and owner_action = 'pending' limit 1;
  if v_id is null then
    v_log := v_log || E'[SKIP] A6 ไม่พบ R7 ที่ยัง pending (ถูกตอบไปแล้ว)\n';
  else
    v_t := pg_temp.ok(null, format($u$update analytics.recommendation_log set owner_action = 'rejected', acted_at = now(), outcome_note = 'ยกระดับเป็น R10' where id = %L$u$, v_id));
    v_log := v_log || pg_temp.vb('A6', 'Tech Lead ปิดข้อเสนอจริง (R7) ด้วย UPDATE ตรง owner_action/acted_at/outcome_note ผ่านหลัง 0162', v_t = 'OK', v_t);
    select * into r from analytics.recommendation_log where id = v_id;
    v_log := v_log || pg_temp.vb('A6b', 'แถวหลังปิด: rejected · acted_at ไม่ null · updated_at ขยับ (trigger เดิมยังทำงาน)', r.owner_action = 'rejected' and r.acted_at is not null and r.updated_at >= r.acted_at, '');
    v_t := pg_temp.ex(null, format($u$update analytics.recommendation_log set title = 'R7 แก้ย้อนหลัง' where id = %L$u$, v_id), array['55000']);
    v_log := v_log || pg_temp.vb('A6c', 'แก้ title ของแถวที่ตอบแล้วตรงๆ ด้วย postgres → 55000 (เขียนประวัติย้อนหลังไม่ได้ — ก่อน 0162 ผ่านได้)', case when v_has162 then v_t like 'OK%' else true end, left(v_t, 90));
    v_t := pg_temp.ok(null, format($u$update analytics.recommendation_log set outcome_note = 'ยกระดับเป็น R10 (แก้คำผิด)' where id = %L$u$, v_id));
    v_log := v_log || pg_temp.vb('A6d', 'แก้ outcome_note ของแถวที่ตอบแล้วด้วย postgres ยังผ่าน (ใช้แก้คำผิดของ Tech Lead)', v_t = 'OK', v_t);
  end if;
  -- A7: อ่านแบบ task ขั้น 2 (owner_action/acted_at/outcome_note ของฉบับก่อน) ด้วย role ของ session และ service_role
  v_t := pg_temp.ok(null, $s$select count(*)::text from (select id, owner_action, acted_at, outcome_note, title from analytics.recommendation_log where source = 'weekly_brief' order by created_at desc limit 20) z$s$);
  v_log := v_log || pg_temp.vb('A7', 'SELECT แบบ task ขั้น 2 ผ่านด้วย role ของ session', v_t = 'OK', v_t);
  v_t := pg_temp.ok('service_role', $s$select count(*)::text from analytics.recommendation_log$s$);
  v_log := v_log || pg_temp.vb('A7b', 'service_role ยังอ่าน recommendation_log ได้ (REVOKE เฉพาะเขียน)', v_t = 'OK', v_t);
  v_t := pg_temp.vq('service_role', format($i$insert into analytics.recommendation_log (shop_id, source, title, detail) values (%L, 'adhoc', 'qa ตรงจากแอป', 'x') returning id::text$i$, v_shop));
  v_log := v_log || pg_temp.vb('A7c', case when v_has162 then 'service_role INSERT ตรง → ถูกปฏิเสธ (42501 สิทธิ์ · ทางแอปไม่มีผู้เขียนอยู่แล้ว)' else 'ก่อน 0162 service_role INSERT ตรงได้ (baseline)' end,
    case when v_has162 then v_t like 'ERR:42501%' else v_t not like 'ERR:%' end, left(v_t, 80));

  -- A8: ทางเรียก RPC ผ่าน MCP (execute_sql = role postgres · ไม่มี JWT) — crm_require_owner_admin ใช้ auth.role()/auth.uid()
  if v_has162 then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    v_t := pg_temp.vq(null, pg_temp.q_rc(v_shop, 'R94 · ทดสอบ MCP ไม่มี JWT', 'detail', 'system', 'proposal', 'weekly_brief'));
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    v_log := v_log || pg_temp.vb('A8', 'recommendation_create เรียกจาก postgres โดยไม่มี JWT claims (แบบ MCP ตรงๆ) → 42501', v_t like 'ERR:42501%', left(v_t, 110));
    v_log := v_log || pg_temp.note('A8', '🔴 N16 สเปกบอก "Tech Lead เปลี่ยนไปเรียก recommendation_create ตั้งแต่ 0162" — ผ่าน MCP ต้องตั้ง select set_config(''request.jwt.claims'', ''{"role":"service_role"}'', true) ในคำสั่งเดียวกันก่อน ไม่งั้น 42501 · ต้องใส่ใน skill 3j-content-orchestration/weekly-brief SKILL.md');
    v_t := pg_temp.vq(null, 'select set_config(''request.jwt.claims'', ''{"role":"service_role"}'', true) || '' / '' || analytics.recommendation_create(' || quote_literal(v_shop) || '::uuid, ''R94 · ทดสอบ MCP มี JWT'', ''detail'', ''system'', ''proposal'', ''weekly_brief'')::text');
    v_log := v_log || pg_temp.vb('A8b', 'ตั้ง claims service_role ในคำสั่งเดียวกัน → recommendation_create ผ่านจาก postgres', v_t not like 'ERR:%', left(v_t, 90));
  else
    v_log := v_log || E'[SKIP] A8 ไม่มี recommendation_create (ก่อน 0162)\n';
  end if;

  -- A9: ขีดจำกัด RPC เทียบ "ของจริงที่ Tech Lead เขียนเอง" (R-rows จริง 12 แถว) — ถ้า Brief ถัดไปยาวเท่าเดิม RPC ต้องรับได้
  select max(length(title)) as mt, max(length(detail)) as md,
         count(*) filter (where effort_minutes_est is not null and (effort_minutes_est < 1 or effort_minutes_est > 480)) as ne,
         count(*) filter (where detail ~ '[​‎‏؜‪-‮⁠-⁤⁦-⁩﻿]') as nb,
         count(*) filter (where position('[ต้องยืนยัน' in title) > 0) as nm
    into r from analytics.recommendation_log where title not like 'R9_ %' and title not like 'QA %' and title not like 'qa %';
  v_log := v_log || pg_temp.vb('R1', 'แถว reco จริงทุกแถวอยู่ในขีดจำกัดของ recommendation_create: title ≤200 · detail ≤4000 · effort 1..480 · ไม่มี bidi/ZWSP · title ไม่มี [ต้องยืนยัน',
    r.mt <= 200 and r.md <= 4000 and r.ne = 0 and r.nb = 0 and r.nm = 0, format('title สูงสุด %s · detail สูงสุด %s · effort นอกช่วง %s · bidi %s · marker %s', r.mt, r.md, r.ne, r.nb, r.nm));
  select string_agg(left(id::text, 8) || ':' || length(detail), ', ') into v_t from analytics.recommendation_log where length(detail) > 3000 and title not like 'R9_ %';
  v_log := v_log || pg_temp.note('R1b', 'detail จริงที่ยาว >3000 ตัวอักษร (ใกล้เพดาน 4000): ' || coalesce(v_t, 'ไม่มี'));

  ----------------------------------------------------------------------------
  -- B. หน้า calendar/copilot + ข้อมูลเดิมระดับ campaign/step
  ----------------------------------------------------------------------------
  v_board0 := pg_temp.qsig('service_role', format('select %s from analytics.v_campaign_board where shop_id = %L', c_board, v_shop));
  v_log := v_log || pg_temp.sig('B1.board_rows', v_board0);
  v_log := v_log || pg_temp.vb('B1a', 'อ่าน v_campaign_board ด้วยรายการคอลัมน์จริงของแอป (CAMPAIGN_BOARD_SELECT 27 คอลัมน์) ภายใต้ service_role ได้', v_board0 not like 'ERR:%', left(v_board0, 60));
  v_log := v_log || pg_temp.sig('B1.board_def', (select md5(pg_get_viewdef('analytics.v_campaign_board'::regclass))));
  v_log := v_log || pg_temp.sig('B1.board_cols', pg_temp.colsig('v_campaign_board'));
  v_log := v_log || pg_temp.sig('B2.campaign_oldcols', pg_temp.colsig('campaign', c_new_cmp));
  execute format('select count(*)::text || '':'' || md5(coalesce(string_agg(t::text, E''\n'' order by t::text), '''')) from (select %s from analytics.campaign) t',
    (select string_agg(quote_ident(column_name), ', ' order by ordinal_position) from information_schema.columns
      where table_schema = 'analytics' and table_name = 'campaign' and column_name <> all (c_new_cmp))) into v_t;
  v_log := v_log || pg_temp.sig('B2.campaign_rows_oldcols', v_t);
  execute 'select count(*)::text || '':'' || md5(coalesce(string_agg(t::text, E''\n'' order by t::text), '''')) from (select * from analytics.campaign_step) t' into v_t;
  v_log := v_log || pg_temp.sig('B3.step_rows', v_t);
  foreach v_t2 in array array['v_content_piece', 'v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_entry_queue', 'v_recommendation_acceptance'] loop
    v_log := v_log || pg_temp.sig('B4.' || v_t2 || '.def', (select md5(pg_get_viewdef(('analytics.' || v_t2)::regclass))));
    v_log := v_log || pg_temp.vb('B4.' || v_t2, 'view เดิม select ได้ภายใต้ service_role', pg_temp.ok('service_role', format('select count(*)::text from analytics.%I', v_t2)) = 'OK');
  end loop;
  v_log := v_log || pg_temp.sig('B4.piece_rows', pg_temp.qsig('service_role', 'select * from analytics.v_content_piece'));
  -- B5: ทางเขียนเดิมของบอร์ด (status) ภายใต้ service_role ต้องไม่ถูก guard ใหม่ปฏิเสธ
  if v_has10 then
    v_t := pg_temp.ok('service_role', format($u$update analytics.campaign set status = 'blocked' where id = %L$u$, c_camp));
    v_log := v_log || pg_temp.vb('B5', 'service_role UPDATE campaign.status (ทางบอร์ดเดิม) ยังผ่านหลัง trg_campaign_result_guard', v_t = 'OK', v_t);
    v_t := pg_temp.ok('service_role', format($u$update analytics.campaign set status = 'scheduled' where id = %L$u$, c_camp));
    v_log := v_log || pg_temp.vb('B5b', 'ย้อน status กลับ scheduled ได้', v_t = 'OK', v_t);
  end if;

  ----------------------------------------------------------------------------
  -- C. แคมเปญ 10.10 จริง — metric orders · ช่องทาง LINE · กลุ่มเงินแท่ง · 7–10 ต.ค. · ฐาน 0.5 · เกณฑ์ ≥6
  ----------------------------------------------------------------------------
  if not v_has162 then
    v_log := v_log || E'[SKIP] C/D/E ต้องมี 0162\n';
  elsif not v_has10 then
    v_log := v_log || E'[SKIP] C ไม่พบแคมเปญ 10.10 ในร้านจริง\n';
  else
    select max(fo.order_date) into v_through from analytics.fact_order fo join analytics.dim_channel dc on dc.id = fo.channel_id where fo.shop_id = v_shop and dc.code = 'line_oa';
    v_log := v_log || pg_temp.note('C0', format('ข้อมูลออเดอร์ LINE ถึง %s (วันไทยวันนี้ %s) · ออเดอร์ทั้งร้านถึง %s · LINE+เงินแท่ง 7 วันล่าสุด = %s ออเดอร์', v_through, v_today,
      (select max(order_date) from analytics.fact_order where shop_id = v_shop), pg_temp.ind(v_shop, v_today - 6, v_today, 'line_oa', 'bar')));
    select md5(string_agg(t::text, E'\n' order by t::text)) into v_board0 from (select step_id, step_status, effective_status, resolved_start, art_total, art_done, gates::text from analytics.v_campaign_board where campaign_id = c_camp) t;

    -- C1: AI/ระบบตั้งแผนบนแคมเปญที่มีชิ้น posted แล้วไม่ได้ (10.10 มีชิ้น LINE posted) · owner ตั้งได้
    v_t := pg_temp.ex('service_role', pg_temp.q_plan(v_shop, c_camp, '{"metric_code":"orders"}', 'ai'), array['42501']);
    v_log := v_log || pg_temp.vb('C1', '10.10: actor ai ตั้ง metric ไม่ได้ (มีชิ้น LINE ที่ posted แล้ว) → 42501', v_t like 'OK%', left(v_t, 100));
    v_j := pg_temp.vj('service_role', pg_temp.q_plan(v_shop, c_camp,
      '{"metric_code":"orders","metric_channel_code":"line_oa","metric_affinity":"bar","metric_date_from":"2026-10-07","metric_date_to":"2026-10-10","baseline_value":0.5,"pass_threshold":6,"pass_op":">="}', 'owner'));
    v_log := v_log || pg_temp.vb('C2', 'owner ตั้งตามที่ Tech Lead ต้องการ (orders · line_oa · bar · 2026-10-07..10 · ฐาน 0.5 · เกณฑ์ ≥ 6) ผ่าน · changed 8 key',
      not v_j ? 'error' and (select count(*) from jsonb_object_keys(v_j -> 'changed')) = 8, left(v_j::text, 120));
    select * into r from analytics.campaign where id = c_camp;
    v_log := v_log || pg_temp.vb('C2b', 'ค่าที่เก็บ: baseline_value เป็น 0.5 เป๊ะ (ไม่ถูกปัด) · threshold 6 · op >= · ช่วงวัน 7–10 ต.ค. · status ยัง scheduled (ตั้งแผนไม่ปิดแคมเปญ)',
      r.baseline_value = 0.5 and r.pass_threshold = 6 and r.pass_op = '>=' and r.metric_date_from = date '2026-10-07' and r.metric_date_to = date '2026-10-10'
      and r.metric_channel_code = 'line_oa' and r.metric_affinity = 'bar' and r.status = 'scheduled' and r.result_verdict = 'not_measured' and r.result_verdict_confirmed_at is null,
      concat_ws('|', r.baseline_value, r.pass_threshold, r.status));
    select * into r from analytics.v_campaign_summary where campaign_id = c_camp;
    v_ind := pg_temp.ind(v_shop, date '2026-10-07', date '2026-10-10', 'line_oa', 'bar');
    v_log := v_log || pg_temp.vb('C3', 'v_campaign_summary: ช่วงวัน 7–10 ต.ค. · orders_actual = นับอิสระจาก fact_order (line_oa × เงินแท่ง) · channel/affinity ตรง',
      r.orders_window_from = date '2026-10-07' and r.orders_window_to = date '2026-10-10' and r.orders_actual = v_ind and r.orders_channel = 'line_oa' and r.orders_affinity = 'bar',
      format('view=%s ดิบ=%s', r.orders_actual, v_ind));
    -- SEC-H1: data_through = วันล่าสุดที่ "ร้าน" มีออเดอร์ทุกช่องทาง (ไม่กรอง line_oa) — ไฟล์ import เข้าทีเดียวทุกช่องทาง
    select max(order_date) into v_thr_shop from analytics.fact_order where shop_id = v_shop;
    select max(fo.order_date) into v_thr_chan from analytics.fact_order fo join analytics.dim_channel dc on dc.id = fo.channel_id where fo.shop_id = v_shop and dc.code = 'line_oa';
    v_log := v_log || pg_temp.vb('C3b', 'orders_data_through = วันล่าสุดที่ร้านมีออเดอร์ (ทุกช่องทาง) · channel_data_through = วันล่าสุดของ line_oa · covers_window (R-H1 รอบ 2) = (ร้านถึง > 10 ต.ค.) และ (line_oa ถึง ≥ 10 ต.ค.) = ' || coalesce((v_thr_shop > date '2026-10-10' and v_thr_chan >= date '2026-10-10')::text, 'false'),
      r.orders_data_through = v_thr_shop and r.orders_channel_data_through is not distinct from v_thr_chan
      and r.orders_data_covers_window is not distinct from coalesce(v_thr_shop > date '2026-10-10' and v_thr_chan >= date '2026-10-10', false), format('through=%s (LINE %s) covers=%s', r.orders_data_through, v_through, r.orders_data_covers_window));
    v_log := v_log || pg_temp.note('C3c', format('10.10 วันนี้: นับได้ %s ออเดอร์ (เกณฑ์ ≥ 6) · ข้อมูลถึง %s · covers_window=%s · threshold_met=%s — ⚠️ 0 ออเดอร์ที่นี่แปลว่า "ข้อมูลยังไม่เข้า" ไม่ใช่ "แคมเปญล้มเหลว" ถ้า through < 10 ต.ค.',
      r.orders_actual, r.orders_data_through, r.orders_data_covers_window, r.orders_threshold_met));
    select count(*) filter (where piece_status is not null), count(*) filter (where piece_status = 'posted'),
           count(*) filter (where piece_status is not null and piece_status not in ('posted', 'cancelled'))
      into v_n, v_n2, v_n3 from analytics.campaign_step where campaign_id = c_camp;
    v_log := v_log || pg_temp.vb('C3d', 'threshold_too_narrow = false (ไม่มี spread) · ชิ้น total/posted/open = นับอิสระจาก campaign_step · stage ตามกติกา (posted>0 และไม่มีชิ้นค้าง = awaiting_read) · verdict_display ว่าง',
      r.threshold_too_narrow is false and r.pieces_total = v_n and r.pieces_posted = v_n2 and r.pieces_open = v_n3 and r.verdict_display is null
      and r.stage = (case when v_n > 0 and v_n3 = 0 and v_n2 > 0 then 'awaiting_read' else 'running' end), format('%s/%s/%s %s', r.pieces_total, r.pieces_posted, r.pieces_open, r.stage));
    v_open10 := v_n3;   -- จำนวนชิ้นค้างจริงของ 10.10 — เทียบ result_open_pieces ตอน C10

    -- C4: เทียบนับอิสระหลายช่วงวัน (ช่วงที่มีข้อมูลจริง · คร่อมขอบข้อมูล · วันเดียว · ขอบเกินข้อมูล) × 3 รูปแบบขอบเขต
    for r in
      select * from (values
        ('ย้อน 13 วันถึงวันข้อมูลล่าสุด', v_through - 13, v_through),
        ('1–10 ต.ค. (คร่อมขอบข้อมูล)', date '2026-10-01', date '2026-10-10'),
        ('วันข้อมูลล่าสุดวันเดียว', v_through, v_through),
        ('หลังข้อมูลล่าสุดทั้งช่วง', v_through + 1, v_through + 4),
        ('ก.ย. ทั้งเดือน (ก่อนแคมเปญ)', date '2026-09-01', date '2026-09-30')) as w(lbl, d1, d2)
    loop
      foreach v_t2 in array array['line_oa|bar', 'line_oa|all', 'null|all', 'tiktok|all', 'null|bar'] loop
        v_t := split_part(v_t2, '|', 1);
        v_j := pg_temp.vj('service_role', pg_temp.q_plan(v_shop, c_camp, format('{"metric_channel_code":%s,"metric_affinity":"%s","metric_date_from":"%s","metric_date_to":"%s"}',
                 case when v_t = 'null' then 'null' else '"' || v_t || '"' end, split_part(v_t2, '|', 2), r.d1, r.d2), 'owner'));
        if v_j ? 'error' and v_j ->> 'msg' not like '%ไม่มีค่าเปลี่ยน%' then
          v_log := v_log || pg_temp.vb('C4 ' || r.lbl || ' ' || v_t2, 'plan_set ล้มเหลว', false, left(v_j::text, 150));
          continue;
        end if;
        select orders_actual, orders_data_covers_window into v_actual, v_c10 from analytics.v_campaign_summary where campaign_id = c_camp;
        v_ind := pg_temp.ind(v_shop, r.d1, r.d2, case when v_t = 'null' then null else v_t end, split_part(v_t2, '|', 2));
        v_log := v_log || pg_temp.vb('C4 ' || r.lbl || ' ' || v_t2, 'orders_actual = นับอิสระ · covers = (ร้านถึง > วันสุดท้าย) และ (ช่องที่นับถึง ≥ วันสุดท้าย — ถ้าระบุช่องทาง)', v_actual = v_ind and v_c10 is not distinct from coalesce(
            (select max(fo.order_date) from analytics.fact_order fo where fo.shop_id = v_shop) > r.d2
            and (v_t = 'null' or (select max(fo.order_date) from analytics.fact_order fo join analytics.dim_channel dc on dc.id = fo.channel_id
                                   where fo.shop_id = v_shop and dc.code = v_t) >= r.d2), false),
          format('view=%s ดิบ=%s covers=%s', v_actual, v_ind, v_c10));
        v_log := v_log || pg_temp.sig('C4.' || r.lbl || '.' || v_t2, v_actual::text);   -- ข้อมูลจริงเสถียร ⇒ เทียบข้ามรอบได้
      end loop;
    end loop;

    -- C5: เกณฑ์ผ่านเทียบกับนับจริง (>= / <= · ขอบเท่ากัน)
    v_j := pg_temp.vj('service_role', pg_temp.q_plan(v_shop, c_camp, format('{"metric_channel_code":"line_oa","metric_affinity":"bar","metric_date_from":"%s","metric_date_to":"%s"}', v_through - 13, v_through), 'owner'));
    v_actual := pg_temp.ind(v_shop, v_through - 13, v_through, 'line_oa', 'bar');
    foreach v_t2 in array array['>=|0', '>=|1', '<=|0', '<=|-1'] loop
      perform pg_temp.vj('service_role', pg_temp.q_plan(v_shop, c_camp, format('{"pass_threshold":%s,"pass_op":"%s"}', v_actual + split_part(v_t2, '|', 2)::int, split_part(v_t2, '|', 1)), 'owner'));
      select * into r from analytics.v_campaign_summary where campaign_id = c_camp;
      v_log := v_log || pg_temp.vb('C5 ' || v_t2, format('เกณฑ์ %s %s เทียบจริง %s → threshold_met', split_part(v_t2, '|', 1), v_actual + split_part(v_t2, '|', 2)::int, v_actual),
        r.orders_threshold_met is not distinct from (case split_part(v_t2, '|', 1) when '>=' then v_actual >= v_actual + split_part(v_t2, '|', 2)::int else v_actual <= v_actual + split_part(v_t2, '|', 2)::int end), coalesce(r.orders_threshold_met::text, 'null'));
    end loop;
    -- C6: spread (ทศนิยม) → threshold_too_narrow เทียบตัวเลขจริง
    perform pg_temp.vj('service_role', pg_temp.q_plan(v_shop, c_camp, '{"baseline_value":0.5,"pass_threshold":6,"pass_op":">=","baseline_spread":7}', 'owner'));
    select threshold_too_narrow into v_c10 from analytics.v_campaign_summary where campaign_id = c_camp;
    v_log := v_log || pg_temp.vb('C6', 'ฐาน 0.5 · เกณฑ์ 6 · spread 7 → |6−0.5| = 5.5 < 7 ⇒ threshold_too_narrow = true', v_c10 is true);
    perform pg_temp.vj('service_role', pg_temp.q_plan(v_shop, c_camp, '{"baseline_spread":5}', 'owner'));
    select threshold_too_narrow into v_c10 from analytics.v_campaign_summary where campaign_id = c_camp;
    v_log := v_log || pg_temp.vb('C6b', 'spread 5 → 5.5 < 5 เท็จ ⇒ false (ไม่ปัดเป็นจำนวนเต็ม)', v_c10 is false);
    -- กลับไปค่าที่ Tech Lead ต้องการจริง
    perform pg_temp.vj('service_role', pg_temp.q_plan(v_shop, c_camp,
      '{"baseline_spread":null,"metric_channel_code":"line_oa","metric_affinity":"bar","metric_date_from":"2026-10-07","metric_date_to":"2026-10-10","pass_threshold":6,"pass_op":">="}', 'owner'));
    select count(*) into v_n from analytics.campaign where id = c_camp and metric_code = 'orders' and metric_date_from = date '2026-10-07' and metric_date_to = date '2026-10-10'
       and pass_threshold = 6 and pass_op = '>=' and baseline_value = 0.5 and baseline_spread is null;
    v_log := v_log || pg_temp.vb('C6c', 'กลับสู่ค่าตาม brief ครบ (10.10 · orders · ≥6 · ฐาน 0.5)', v_n = 1);

    -- C7: แคมเปญอื่น 12 แถว: metric_code null ⇒ orders_* ว่างหมด · มี 1 แถวต่อแคมเปญ · ไม่ขยับเพราะตั้ง 10.10
    select count(*) into v_n from analytics.v_campaign_summary s where s.shop_id = v_shop and s.campaign_id <> c_camp
       and coalesce(s.metric_code, '') <> 'orders'
       and (s.orders_actual is not null or s.orders_window_from is not null or s.orders_data_through is not null or s.orders_threshold_met is not null);
    v_log := v_log || pg_temp.vb('C7', 'แคมเปญอื่นที่ metric ไม่ใช่ orders: orders_* ว่างหมด (ตั้ง 10.10 ไม่รั่วไปแคมเปญอื่น · ไม่ผูกว่า metric_code ต้องว่าง)', v_n = 0, 'พบ ' || v_n);
    select count(*) into v_n from analytics.v_campaign_summary where shop_id = v_shop;
    v_log := v_log || pg_temp.vb('C7b', 'v_campaign_summary 1 แถว/แคมเปญ = นับ campaign ของร้าน (ไม่ผูกจำนวนตายตัว)', v_n = (select count(*) from analytics.campaign where shop_id = v_shop), v_n::text);

    -- C8: ด่านคำตัดสิน (orders) บน 10.10 จริง
    perform pg_temp.vj('service_role', pg_temp.q_plan(v_shop, c_camp, '{"pass_threshold":null,"pass_op":null}', 'owner'));
    v_t := pg_temp.ex('service_role', pg_temp.q_prop(v_shop, c_camp, 'validated', 'ออเดอร์ถึงเกณฑ์', 'ai'), array['55000']);
    v_log := v_log || pg_temp.vb('C8', 'ไม่มีเกณฑ์ผ่าน (pass_threshold ว่าง) → AI เสนอ validated ไม่ได้ 55000', v_t like 'OK%', left(v_t, 100));
    v_t := pg_temp.ok('service_role', pg_temp.q_prop(v_shop, c_camp, 'inconclusive', 'ข้อมูลออเดอร์ยังไม่ถึงวันสุดท้ายของช่วง', 'ai'));
    v_log := v_log || pg_temp.vb('C8b', 'inconclusive เสนอได้เสมอแม้ยังไม่ตั้งเกณฑ์', v_t = 'OK', v_t);
    perform pg_temp.vj('service_role', pg_temp.q_plan(v_shop, c_camp, '{"pass_threshold":6,"pass_op":">="}', 'owner'));
    -- SEC-H1 (ปิดช่องเดิมที่ QA เคยบันทึกไว้ที่ C8c): ข้อมูลร้านยังไม่ถึงวันสุดท้ายของช่วง ⇒ AI เสนอ "invalidated" (ยอด 0 ที่ยังไม่เข้า) ถูกปฏิเสธ 55000 · ถ้าข้อมูลถึงแล้ว ผ่านตามปกติ
    select * into r from analytics.v_campaign_summary where campaign_id = c_camp;
    v_t := pg_temp.vq('service_role', pg_temp.q_prop(v_shop, c_camp, 'invalidated', 'นับได้ 0 ออเดอร์เทียบเกณฑ์ ≥ 6', 'ai'));
    if r.orders_data_covers_window is true then
      v_prop := 'invalidated';
      v_log := v_log || pg_temp.vb('C8c', format('ข้อมูลร้านถึง %s ครอบช่วงจบ %s แล้ว: AI เสนอ invalidated ผ่าน (ด่าน SEC-H1 ไม่บล็อกเมื่อข้อมูลครบ)', r.orders_data_through, r.orders_window_to), v_t not like 'ERR:%', left(v_t, 80));
    else
      v_prop := 'inconclusive';
      v_log := v_log || pg_temp.vb('C8c', format('SEC-H1 บนข้อมูลจริง: ข้อมูลร้านถึง %s แต่ช่วงจบ %s (covers=false · นับได้ %s) ⇒ AI เสนอ invalidated ถูกปฏิเสธ 55000', r.orders_data_through, r.orders_window_to, r.orders_actual), v_t like 'ERR:55000%', left(v_t, 90));
      v_t := pg_temp.ok('service_role', pg_temp.q_prop(v_shop, c_camp, 'inconclusive', 'ข้อมูลออเดอร์ยังไม่ถึงวันสุดท้ายของช่วง — ยังตัดสินไม่ได้', 'ai'));
      v_log := v_log || pg_temp.vb('C8d', 'ข้อมูลยังไม่ถึง: AI ยังเสนอ inconclusive ได้ (ปิดได้ทุกเมื่อ — Q12)', v_t = 'OK', v_t);
    end if;

    -- R-H1 รอบ 2 บนข้อมูลจริง (sub-block ที่ rollback เอง — ไม่กระทบแผนของ 10.10 ที่ C9 ใช้ต่อ)
    --   C8e วันท้ายของข้อมูลจริง: ช่วง X..X โดย X = วันล่าสุดที่ร้านมีออเดอร์ (ไฟล์ยังเข้าไม่ครบวันนั้น — พิสูจน์แล้ว 6 ต.ค.: LINE มี TikTok 0) ⇒ ไม่มีข้อมูลวันหลัง ⇒ ฟันธงไม่ได้
    --   C8f ช่องทางที่ข้อมูลช้ากว่าร้านอย่างน้อย 2 วัน (ถ้ามีจริง): ช่วง (วันล่าสุดของช่อง + 1) ทั้งที่ร้านมีข้อมูลหลังจากนั้น ⇒ ช่องนี้ไม่ครอบ · ไม่มีช่องที่ช้าพอ = [NOTE] (สร้างด้วยข้อมูลจริงไม่ได้ — fixture อยู่ verify-0162 H1n)
    if v_thr_shop is not null then
      begin
        perform pg_temp.vj('service_role', pg_temp.q_plan(v_shop, c_camp, format('{"metric_channel_code":"line_oa","metric_affinity":"all","metric_date_from":"%s","metric_date_to":"%s","pass_threshold":1,"pass_op":">="}', v_thr_shop, v_thr_shop), 'owner'));
        select * into r from analytics.v_campaign_summary where campaign_id = c_camp;
        v_t := pg_temp.vq('service_role', pg_temp.q_prop(v_shop, c_camp, 'invalidated', 'วันท้ายของข้อมูลจริงยอดไม่ถึงเกณฑ์', 'ai'));
        v_log := v_log || pg_temp.vb('C8e', format('วันท้ายของข้อมูลจริง (ร้านถึง %s · ช่วง %s..%s · line_oa): covers=false (ไม่มีข้อมูลวันหลัง) ⇒ AI เสนอ invalidated ถูกปฏิเสธ 55000', r.orders_data_through, r.orders_window_from, r.orders_window_to),
          r.orders_data_covers_window is false and v_t like 'ERR:55000%', left(v_t, 90));
        v_t := pg_temp.vq('service_role', pg_temp.q_prop(v_shop, c_camp, 'validated', 'วันท้ายของข้อมูลจริงยอดถึงเกณฑ์', 'ai'));
        v_log := v_log || pg_temp.vb('C8e2', 'วันท้ายของข้อมูลจริง: AI เสนอ validated ถูกปฏิเสธ 55000 เช่นกัน', v_t like 'ERR:55000%', left(v_t, 90));
        raise exception 'c8e-rb';
      exception when others then
        if sqlerrm <> 'c8e-rb' then
          v_log := v_log || format(E'[FAIL] C8e ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 200));
        end if;
      end;
      select dc.code, max(fo.order_date) as d into v_t, v_thr_chan
        from analytics.fact_order fo join analytics.dim_channel dc on dc.id = fo.channel_id
       where fo.shop_id = v_shop
       group by dc.code
      having max(fo.order_date) + 1 < v_thr_shop
       order by max(fo.order_date) limit 1;
      if v_t is null then
        v_log := v_log || pg_temp.note('C8f', 'ไม่มีช่องทางที่ข้อมูลช้ากว่าร้านเกิน 1 วันในข้อมูลจริงตอนนี้ — ไม่ได้ทดสอบ "ช่องอื่นมีข้อมูลแต่ช่องนี้ไม่มี" บนข้อมูลจริง (ครอบด้วย fixture ที่ verify-0162 H1n/H1o)');
      else
        begin
          perform pg_temp.vj('service_role', pg_temp.q_plan(v_shop, c_camp, format('{"metric_channel_code":"%s","metric_affinity":"all","metric_date_from":"%s","metric_date_to":"%s","pass_threshold":1,"pass_op":">="}', v_t, v_thr_chan + 1, v_thr_chan + 1), 'owner'));
          select * into r from analytics.v_campaign_summary where campaign_id = c_camp;
          v_t2 := pg_temp.vq('service_role', pg_temp.q_prop(v_shop, c_camp, 'invalidated', 'ช่องที่ข้อมูลช้ากว่า ยอดไม่ถึงเกณฑ์', 'ai'));
          v_log := v_log || pg_temp.vb('C8f', format('ช่อง %s ข้อมูลถึง %s แต่ร้านถึง %s: ช่วง %s..%s ⇒ covers=false · AI เสนอ invalidated ถูกปฏิเสธ 55000', v_t, v_thr_chan, r.orders_data_through, r.orders_window_from, r.orders_window_to),
            r.orders_data_covers_window is false and v_t2 like 'ERR:55000%', left(v_t2, 90));
          raise exception 'c8f-rb';
        exception when others then
          if sqlerrm <> 'c8f-rb' then
            v_log := v_log || format(E'[FAIL] C8f ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 200));
          end if;
        end;
      end if;
    end if;

    -- C9: วงจร propose (AI) → inbox → confirm (owner) บน 10.10 จริง
    select count(*) into v_n from analytics.v_recommendation_inbox where shop_id = v_shop and item_kind = 'campaign_verdict' and item_id = c_camp and effective_action = 'pending';
    v_log := v_log || pg_temp.vb('C9a', 'ข้อเสนอ AI บน 10.10 โผล่ใน inbox 1 แถว (campaign_verdict · pending · ตอบผ่าน campaign_verdict_confirm)', v_n = 1
      and (select respond_via from analytics.v_recommendation_inbox where item_id = c_camp and item_kind = 'campaign_verdict') = 'campaign_verdict_confirm', v_n::text);
    select * into r from analytics.v_campaign_summary where campaign_id = c_camp;
    v_log := v_log || pg_temp.vb('C9b', 'v_campaign_summary: verdict_display = proposed:<ข้อเสนอ AI> · awaiting_confirm · result_verdict ยัง not_measured (ข้อเสนอไม่ใช่คำตัดสิน)',
      r.verdict_display = 'proposed:' || v_prop and r.awaiting_confirm and r.result_verdict = 'not_measured' and r.result_verdict_confirmed_at is null, coalesce(r.verdict_display, 'null'));
    v_t := pg_temp.ex('service_role', pg_temp.q_conf(v_shop, c_camp, 'validated', 'บทเรียน', 'owner', null, null), array['22023']);
    v_log := v_log || pg_temp.vb('C9c', 'confirm โดยไม่ส่ง p_expected_proposed (null) → 22023', v_t like 'OK%', left(v_t, 90));
    v_t := pg_temp.ex('service_role', pg_temp.q_conf(v_shop, c_camp, 'validated', 'บทเรียน', 'owner', null, 'validated'), array['55000']);
    v_log := v_log || pg_temp.vb('C9d', 'confirm ด้วย expected ที่เจ้าของเห็นไม่ตรงข้อเสนอจริง → 55000 (CAS)', v_t like 'OK%', left(v_t, 90));
    v_t := pg_temp.ex('service_role', pg_temp.q_conf(v_shop, c_camp, 'invalidated', 'บทเรียน', 'ai', null, 'invalidated'), array['42501']);
    v_log := v_log || pg_temp.vb('C9e', 'AI ยืนยันแทนเจ้าของ → 42501', v_t like 'OK%', left(v_t, 90));
    select md5(string_agg(t::text, E'\n' order by t::text)) into v_t2 from (select * from analytics.campaign where id = c_camp) t;
    v_j := pg_temp.vj('service_role', pg_temp.q_conf(v_shop, c_camp, 'inconclusive', 'ข้อมูลออเดอร์ยังไม่ครบช่วง — ตัดสินยังไม่ได้ (QA)', 'owner', 'ยืนยันโดย QA ในทรานแซกชัน rollback', v_prop));
    select * into r from analytics.campaign where id = c_camp;
    v_log := v_log || pg_temp.vb('C10', 'เจ้าของยืนยัน inconclusive (ขัดข้อเสนอ AI ได้) → result_verdict · status=done · confirmed_by_role=owner · result_open_pieces = จำนวนชิ้นค้างจริงของ 10.10 · proposed ไม่ถูกล้าง',
      not v_j ? 'error' and r.result_verdict = 'inconclusive' and r.status = 'done' and r.result_verdict_confirmed_by_role = 'owner' and r.result_open_pieces = v_open10
      and r.result_verdict_proposed = v_prop and r.lesson is not null, left(v_j::text, 140));
    v_log := v_log || pg_temp.vb('C10b', 'payload ยืนยัน: orders.actual = นับอิสระ · data_covers_window ตรง view · open_pieces=0 · signal_id ไม่ null (บทเรียน → insight)',
      (v_j -> 'orders' ->> 'actual')::int = pg_temp.ind(v_shop, date '2026-10-07', date '2026-10-10', 'line_oa', 'bar') and v_j ->> 'signal_id' is not null and (v_j ->> 'open_pieces')::int = v_open10,
      left((v_j -> 'orders')::text, 130));
    select count(*) into v_n from analytics.v_recommendation_inbox where shop_id = v_shop and item_kind = 'campaign_verdict' and item_id = c_camp;
    v_log := v_log || pg_temp.vb('C10c', 'หลังยืนยัน แคมเปญหายจาก inbox (ไม่ค้างเป็น pending)', v_n = 0, v_n::text);
    select md5(string_agg(t::text, E'\n' order by t::text)) into v_board1 from (select step_id, step_status, effective_status, resolved_start, art_total, art_done, gates::text from analytics.v_campaign_board where campaign_id = c_camp) t;
    v_log := v_log || pg_temp.vb('C10d', 'R29 บนข้อมูลจริง: ปิดแคมเปญ (status → done) ไม่ทำให้แถว v_campaign_board ของ step 10.10 ขยับ (effective_status/step_status/gates เท่าเดิม)', v_board0 is not distinct from v_board1);
    v_t := pg_temp.ex('service_role', pg_temp.q_plan(v_shop, c_camp, '{"pass_threshold":9}', 'owner'), array['55000']);
    v_log := v_log || pg_temp.vb('C10e', 'ปิดแล้ว: owner แก้แผน (เกณฑ์) ไม่ได้ → 55000', v_t like 'OK%', left(v_t, 90));
    v_t := pg_temp.ex('service_role', pg_temp.q_prop(v_shop, c_camp, 'validated', 'พยายามเสนอทับหลังปิด', 'ai'), array['55000']);
    v_log := v_log || pg_temp.vb('C10f', 'ปิดแล้ว: AI เสนอใหม่ไม่ได้ → 55000', v_t like 'OK%', left(v_t, 90));
    v_t := pg_temp.ex('service_role', format($u$update analytics.campaign set result_verdict = 'validated' where id = %L$u$, c_camp), array['55000']);
    v_log := v_log || pg_temp.vb('C10g', 'ปิดแล้ว: service_role UPDATE result_verdict ตรง → 55000 (guard)', v_t like 'OK%', left(v_t, 90));
    -- เปลี่ยนใจ: ยืนยันซ้ำโดยไม่ส่งบทเรียน (null) → บทเรียนเดิมคงอยู่ (QA-4 — เดิมถูกทับเป็นว่าง)
    v_j2 := pg_temp.vj('service_role', pg_temp.q_conf(v_shop, c_camp, 'not_measured', null, 'owner', null, v_prop));
    select * into r from analytics.campaign where id = c_camp;
    v_log := v_log || pg_temp.vb('C11', 'ยืนยันซ้ำ (เปลี่ยนใจเป็น not_measured) ผ่าน · previous_verdict คืน inconclusive · previous_lesson คืนบทเรียนเดิม', not v_j2 ? 'error' and v_j2 ->> 'previous_verdict' = 'inconclusive'
      and v_j2 ->> 'previous_lesson' is not null and r.result_verdict = 'not_measured', left(v_j2::text, 120));
    v_log := v_log || pg_temp.vb('C11b', 'QA-4 บนแคมเปญจริง: ยืนยันซ้ำโดยไม่ส่ง p_lesson (null) ⇒ campaign.lesson คงเดิม (ไม่ถูกทับเป็นว่าง) · lesson_kept = true', r.lesson is not null and v_j2 ->> 'lesson_kept' = 'true', coalesce(left(r.lesson, 40), 'null'));
  end if;

  ----------------------------------------------------------------------------
  -- D. วงจรบนแคมเปญฟิกซ์เจอร์ (ร้านจริง · rollback): Q12 ปิดขณะมีชิ้นค้าง · AI เสนอ → owner · reco · weekly summary
  ----------------------------------------------------------------------------
  if v_has162 then
    v_camp := pg_temp.mk_camp(v_shop, v_today);
    v_s1 := (select id from analytics.campaign_step where campaign_id = v_camp order by seq limit 1);     -- planned
    v_s2 := pg_temp.mk_piece_in(v_shop, v_camp, v_today);                                                   -- in_review
    v_s3 := pg_temp.mk_posted_in(v_shop, v_camp, v_today);                                                  -- posted
    select * into r from analytics.v_campaign_summary where campaign_id = v_camp;
    v_log := v_log || pg_temp.vb('D1', 'ฟิกซ์เจอร์ 3 ชิ้น (planned + in_review + posted): pieces_total=3 · posted=1 · open=2 · stage=running', r.pieces_total = 3 and r.pieces_posted = 1 and r.pieces_open = 2 and r.stage = 'running',
      concat_ws('|', r.pieces_total, r.pieces_posted, r.pieces_open, r.stage));
    select count(*) into v_pend0 from analytics.v_recommendation_inbox where shop_id = v_shop and effective_action = 'pending';
    v_t := pg_temp.ok('service_role', pg_temp.q_prop(v_shop, v_camp, 'inconclusive', 'ชิ้นยังค้าง 2 ชิ้น ยังฟันธงไม่ได้', 'ai'));
    select count(*) into v_n from analytics.v_recommendation_inbox where shop_id = v_shop and effective_action = 'pending';
    v_log := v_log || pg_temp.vb('D2', 'AI เสนอ → ตัวนับกอง 4 (inbox pending) เพิ่มพอดี 1', v_t = 'OK' and v_n = v_pend0 + 1, format('%s → %s', v_pend0, v_n));
    v_t := pg_temp.ok('service_role', pg_temp.q_prop(v_shop, v_camp, 'inconclusive', 'ข้อเสนอของ owner', 'owner'));
    v_log := v_log || pg_temp.vb('D3', 'owner เสนอทับข้อเสนอของ AI ได้ (ไม่ถูกปฏิเสธ)', v_t = 'OK', left(v_t, 90));
    v_t := pg_temp.ex('service_role', pg_temp.q_prop(v_shop, v_camp, 'not_measured', 'AI ทับของ owner', 'ai'), array['42501']);
    v_log := v_log || pg_temp.vb('D3b', 'AI ทับข้อเสนอที่ owner เป็นคนเสนอ → 42501 (ห้ามทับเงียบ)', v_t like 'OK%', left(v_t, 90));
    v_j := pg_temp.vj('service_role', pg_temp.q_conf(v_shop, v_camp, 'inconclusive', 'บทเรียน Q12: ปิดทั้งที่มีชิ้นค้าง', 'owner', null, 'inconclusive'));
    select * into r from analytics.campaign where id = v_camp;
    v_log := v_log || pg_temp.vb('D4', 'Q12: ปิดขณะมีชิ้นค้าง 2 ชิ้น → ไม่ปฏิเสธ · result_open_pieces=2 · payload open_pieces=2 · by_status {planned:1,in_review:1} · excluded_from_result=2',
      not v_j ? 'error' and r.result_open_pieces = 2 and (v_j ->> 'open_pieces')::int = 2 and (v_j -> 'open_by_status' ->> 'planned')::int = 1 and (v_j -> 'open_by_status' ->> 'in_review')::int = 1
      and (v_j ->> 'excluded_from_result')::int = 2 and r.status = 'done', left(v_j::text, 150));
    select * into r from analytics.v_campaign_summary where campaign_id = v_camp;
    v_log := v_log || pg_temp.vb('D4b', 'หลังปิด: ชิ้นค้างยังอยู่ (ไม่ถูกยกเลิกเงียบ) pieces_open=2 · stage=closed · ผลโพสต์นับเฉพาะชิ้น posted (posts_active_n=1)', r.pieces_open = 2 and r.stage = 'closed' and r.posts_active_n = 1,
      concat_ws('|', r.pieces_open, r.stage, r.posts_active_n));
    select count(*) into v_n from analytics.v_content_piece_calendar where step_id in (v_s1, v_s2);
    select review_queue into v_n2 from analytics.v_content_inbox_counts where shop_id = v_shop;
    v_log := v_log || pg_temp.note('D4c', format('หลังปิดแคมเปญ ชิ้นค้างยังโผล่ในปฏิทิน %s/2 ชิ้น · review_queue(กอง "ต้องตรวจ") ยังนับ in_review ของแคมเปญที่ปิดแล้ว (ตอนนี้ %s) — ตามมติ Q12 หน้าจอต้องเตือน/ให้ยกเลิกเอง', v_n, v_n2));
    select count(*) into v_n from analytics.v_recommendation_inbox where shop_id = v_shop and effective_action = 'pending';
    v_log := v_log || pg_temp.vb('D4d', 'ยืนยันแล้ว → inbox pending กลับเท่าก่อนเสนอ', v_n = v_pend0, format('%s vs %s', v_n, v_pend0));

    -- D5: reco create (AI) → inbox → respond (owner)
    v_t := pg_temp.vq('service_role', pg_temp.q_rc(v_shop, 'QA ข้อเสนอ 😀 มีเส้นตาย', E'บรรทัด 1\nบรรทัด 2 [ต้องยืนยัน] อ้างถึงชิ้นงาน', 'ai', 'question', 'agent', 5, (v_today + 3)::text, 'ถือว่ายังไม่ทำ', case when v_has10 then c_camp::text else null end));
    v_id := case when v_t like 'ERR:%' then null else (v_t::jsonb ->> 'id')::uuid end;   -- 0162 รอบแก้: create คืน jsonb {id, created, conflict}
    v_log := v_log || pg_temp.vb('D5', 'AI สร้างคำถามมีเส้นตายวันไทย+3 · detail มี [ต้องยืนยัน] ได้ (สเปกอนุญาต) · หลายบรรทัดคงอยู่', v_id is not null
      and (select position(E'\n' in detail) > 0 and position('[ต้องยืนยัน]' in detail) > 0 from analytics.recommendation_log where id = v_id), left(v_t, 90));
    select * into r from analytics.v_recommendation_inbox where item_id = v_id;
    v_log := v_log || pg_temp.vb('D5b', 'inbox: pending · days_left=3 · is_late=false · kind=question · default_action ติดมา · respond_via=recommendation_respond', r.effective_action = 'pending' and r.days_left = 3
      and r.is_late is false and r.kind = 'question' and r.default_action = 'ถือว่ายังไม่ทำ' and r.respond_via = 'recommendation_respond', concat_ws('|', r.effective_action, r.days_left, r.kind));
    v_t := pg_temp.vq('service_role', pg_temp.q_rc(v_shop, '  qa ข้อเสนอ 😀 มีเส้นตาย', 'ซ้ำ', 'ai'));
    v_log := v_log || pg_temp.vb('D5c', 'create ชื่อซ้ำ (ต่างตัวพิมพ์/ช่องว่าง) ขณะ pending → ไม่ error (QA-5): คืน id เดิม · created=false · conflict=true (เนื้อหาต่าง)',
      v_t not like 'ERR:%' and (v_t::jsonb ->> 'id') = v_id::text and (v_t::jsonb ->> 'created') = 'false' and (v_t::jsonb ->> 'conflict') = 'true', left(v_t, 110));
    -- หมดเวลา: เลื่อน respond_by ไปเมื่อวานด้วย postgres (ทางที่ Tech Lead/fixture ทำได้) → expired + default_action ยังแสดง
    v_t := pg_temp.ok(null, format($u$update analytics.recommendation_log set respond_by = %L where id = %L$u$, v_today - 1, v_id));
    select * into r from analytics.v_recommendation_inbox where item_id = v_id;
    v_log := v_log || pg_temp.vb('D6', 'เลย respond_by แล้ว → inbox effective_action=expired · days_left=-1 · default_action ยังแสดง · owner_action ในแถวยัง pending (ไม่ mutate)', v_t = 'OK' and r.effective_action = 'expired'
      and r.days_left = -1 and r.default_action = 'ถือว่ายังไม่ทำ' and r.owner_action = 'pending', concat_ws('|', r.effective_action, r.days_left, r.owner_action));
    v_t := pg_temp.ex('service_role', pg_temp.q_rr(v_shop, v_id, 'done', 'ok', 'ai'), array['42501']);
    v_log := v_log || pg_temp.vb('D6b', 'AI ตอบแทนเจ้าของ → 42501', v_t like 'OK%', left(v_t, 80));
    v_j := pg_temp.vj('service_role', pg_temp.q_rr(v_shop, v_id, 'rejected', 'ไม่เอา เพราะ QA ทดสอบตอบช้า', 'owner'));
    select * into r from analytics.v_recommendation_inbox where item_id = v_id;
    v_log := v_log || pg_temp.vb('D6c', 'owner ตอบหลังหมดเวลาได้ (คำตอบจริงชนะค่าเริ่มต้น): late=true · was_expired=true · default_action_was ติดมา · inbox: rejected + is_late=true',
      not v_j ? 'error' and (v_j ->> 'late')::boolean and (v_j ->> 'was_expired')::boolean and v_j ->> 'default_action_was' = 'ถือว่ายังไม่ทำ' and r.effective_action = 'rejected' and r.is_late is true,
      left(v_j::text, 130));
    v_t := pg_temp.ex('service_role', pg_temp.q_rr(v_shop, v_id, 'done', null, 'owner'), array['55000']);
    v_log := v_log || pg_temp.vb('D6d', 'ตอบซ้ำแถวที่ตอบแล้ว → 55000 (CAS)', v_t like 'OK%', left(v_t, 80));
    -- ตอบข้อเสนอจริงที่ "หมดเวลา" (R1 จริง pending เกิน 14 วัน) ด้วย RPC · แถวจริงไม่ถูกแก้เพราะ rollback
    select id into v_id2 from analytics.recommendation_log where owner_action = 'pending' and respond_by is null and now() - created_at > interval '14 days' order by created_at limit 1;
    if v_id2 is null then
      v_log := v_log || E'[SKIP] D7 ไม่มีข้อเสนอจริงที่ pending เกิน 14 วัน\n';
    else
      v_j := pg_temp.vj('service_role', pg_temp.q_rr(v_shop, v_id2, 'done', null, 'owner'));
      v_log := v_log || pg_temp.vb('D7', 'ข้อเสนอจริงที่หมดเวลา (เกิน 14 วัน ไม่มี respond_by) เจ้าของยังตอบ done ได้ · was_expired=true · outcome_note ว่างได้', not v_j ? 'error' and (v_j ->> 'was_expired')::boolean and not (v_j ->> 'late')::boolean,
        left(v_j::text, 120));
    end if;

    -- D8: weekly summary — สร้าง/ส่งซ้ำ/ทับ (สัปดาห์เก่าที่ไม่ชนข้อมูลจริง: จันทร์ 2025-01-06)
    v_mon := date '2025-01-06';
    v_j := pg_temp.vj('service_role', pg_temp.q_ws(v_shop, v_mon, v_mon + 1, '{"สรุปบรรทัด 1 😀","บรรทัด 2"}', E'# Weekly Brief QA\r\n\r\n| ก | ข |\r\n|---|---|\r\n| ไทย 😀 | ✓ |\r\n', 'ai'));
    v_log := v_log || pg_temp.vb('D8', 'AI สร้างฉบับเต็ม (body CRLF + ตาราง + emoji) → created=true · revision=1', not v_j ? 'error' and (v_j ->> 'created')::boolean and (v_j ->> 'revision')::int = 1, left(v_j::text, 100));
    select revision, updated_at, position(E'\r' in body_md) into v_rev, v_upd, v_n from analytics.content_weekly_summary where shop_id = v_shop and week_start = v_mon;
    v_log := v_log || pg_temp.vb('D8b', 'body ถูก normalize เป็น LF (ไม่มี CR ค้าง) · ตารางและ emoji ครบ', v_n = 0 and (select body_md like E'%| ไทย 😀 | ✓ |%' from analytics.content_weekly_summary where shop_id = v_shop and week_start = v_mon));
    perform pg_sleep(0.05);
    v_j := pg_temp.vj('service_role', pg_temp.q_ws(v_shop, v_mon, v_mon + 1, '{"สรุปบรรทัด 1 😀","บรรทัด 2"}', E'# Weekly Brief QA\n\n| ก | ข |\n|---|---|\n| ไทย 😀 | ✓ |\n', 'ai'));
    select count(*) into v_n from analytics.content_weekly_summary where shop_id = v_shop and week_start = v_mon and revision = v_rev and updated_at = v_upd;
    v_log := v_log || pg_temp.vb('D9', 'ส่งเนื้อหาเดิมซ้ำ (ต่างแค่ CRLF/LF) → changed=false · ไม่สร้าง revision ใหม่ · updated_at ไม่ขยับ · 1 แถวเท่าเดิม', not v_j ? 'error' and not (v_j ->> 'changed')::boolean and (v_j ->> 'revision')::int = v_rev and v_n = 1
      and (select count(*) from analytics.content_weekly_summary where shop_id = v_shop and week_start = v_mon) = 1, left(v_j::text, 100));
    v_j := pg_temp.vj('service_role', pg_temp.q_ws(v_shop, v_mon, v_mon + 1, '{"สรุปบรรทัด 1 😀","บรรทัด 2"}', E'# Weekly Brief QA\n\n| ก | ข |\n|---|---|\n| ไทย 😀 | ✓✓ |\n', 'ai'));
    v_log := v_log || pg_temp.vb('D9b', 'แก้ 1 อักขระ → changed=true · revision=2', not v_j ? 'error' and (v_j ->> 'changed')::boolean and (v_j ->> 'revision')::int = v_rev + 1, left(v_j::text, 100));
    v_j := pg_temp.vj('service_role', pg_temp.q_ws(v_shop, v_mon, v_mon + 1, '{"owner แก้"}', E'# owner แก้เอง\n', 'owner'));
    v_t := pg_temp.ex('service_role', pg_temp.q_ws(v_shop, v_mon, v_mon + 1, '{"ai ทับ"}', E'# ai พยายามทับของ owner\n', 'ai'), array['42501']);
    v_log := v_log || pg_temp.vb('D9c', 'owner แก้ฉบับ → revision+1 · AI ทับฉบับที่ owner เขียนล่าสุด → 42501 · system ก็ทับไม่ได้',
      not v_j ? 'error' and (v_j ->> 'revision')::int = v_rev + 2 and v_t like 'OK%'
      and pg_temp.ex('service_role', pg_temp.q_ws(v_shop, v_mon, v_mon + 1, '{"sys ทับ"}', E'# sys\n', 'system'), array['42501']) like 'OK%', left(v_t, 70));
    select count(*) into v_n from analytics.content_weekly_summary where shop_id = v_shop and week_start = v_mon and body_md = E'# owner แก้เอง\n' and updated_by_role = 'owner' and created_by_role = 'ai';
    v_log := v_log || pg_temp.vb('D9d', 'เนื้อหาหลังพยายามทับ = ของ owner ไม่เปลี่ยน · created_by_role ยังเป็น ai (ประวัติผู้สร้างไม่ถูกเขียนทับ)', v_n = 1);
    -- reco ผูก summary แล้วลบ summary ด้วย postgres → reco อยู่ครบ summary_id เป็น null
    select id into v_id from analytics.content_weekly_summary where shop_id = v_shop and week_start = v_mon;
    v_t := pg_temp.vq('service_role', format($r$select analytics.recommendation_create(%L::uuid, 'QA ข้อเสนอผูกสรุป', 'x', 'ai', 'proposal', 'weekly_brief', null, null, null, null, null, %L::uuid)::text$r$, v_shop, v_id));
    v_id2 := case when v_t like 'ERR:%' then null else (v_t::jsonb ->> 'id')::uuid end;
    v_log := v_log || pg_temp.vb('D10', 'สร้างข้อเสนอผูก summary_id ได้ (Brief ฉบับไหนเป็นต้นทาง)', v_id2 is not null and (select summary_id = v_id from analytics.recommendation_log where id = v_id2), left(v_t, 90));
    v_t := pg_temp.ok(null, format($d$delete from analytics.content_weekly_summary where id = %L$d$, v_id));
    select count(*), count(*) filter (where summary_id is null) into v_n, v_n2 from analytics.recommendation_log where id = v_id2;
    v_log := v_log || pg_temp.vb('D10b', 'ลบ summary (postgres) → ข้อเสนอที่ผูกอยู่ครบ summary_id เป็น null (FK SET NULL · ประวัติไม่หาย)', v_t = 'OK' and v_n = 1 and v_n2 = 1, format('%s/%s %s', v_n, v_n2, v_t));
  end if;

  ----------------------------------------------------------------------------
  -- E. v_recommendation_inbox กับข้อมูลจริง (วัดก่อนฟิกซ์เจอร์ไม่ได้แล้ว — ใช้นับอิสระ ณ สถานะปัจจุบันทั้งหมด)
  ----------------------------------------------------------------------------
  if v_has162 then
    v_cols := (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_recommendation_inbox');
    v_log := v_log || pg_temp.vb('E1', 'สัญญาคอลัมน์ inbox: 21 ตัวตามสเปก §13.6 (ชื่อ+ลำดับ) + 2 ตัวท้ายที่รอบแก้ security เพิ่ม (owner_response · content_token)', v_cols = 'item_kind,item_id,shop_id,kind,title,detail,effort_minutes_est,respond_by,default_action,related_campaign_id,related_step_id,summary_id,source,created_at,owner_action,effective_action,days_left,is_late,outcome_note,acted_at,respond_via,owner_response,content_token', v_cols);
    select count(*) into v_n from analytics.v_recommendation_inbox where item_kind = 'reco';
    v_log := v_log || pg_temp.vb('E2', 'แขน reco = ทุกแถวของ recommendation_log (รวมประวัติ done/rejected)', v_n = (select count(*) from analytics.recommendation_log), v_n || ' vs ' || (select count(*) from analytics.recommendation_log));
    -- นับอิสระต่อ effective_action จากตารางดิบ
    select count(*) into v_n from (
      select case when owner_action <> 'pending' then owner_action when respond_by is not null and respond_by < v_today then 'expired'
                  when respond_by is null and now() - created_at > interval '14 days' then 'expired' else 'pending' end ea, count(*) n
        from analytics.recommendation_log group by 1
      except select effective_action, count(*) from analytics.v_recommendation_inbox where item_kind = 'reco' group by 1) z;
    v_log := v_log || pg_temp.vb('E3', 'จำนวนต่อ effective_action (pending/expired/done/rejected) ของแขน reco = นับอิสระจากตารางดิบ', v_n = 0, 'ต่าง ' || v_n);
    select count(*) into v_n from analytics.v_recommendation_inbox i where item_kind = 'reco' and effective_action = 'expired' and owner_action = 'pending' and respond_by is null and now() - created_at <= interval '14 days';
    v_log := v_log || pg_temp.vb('E3b', 'ไม่มีแถวที่ถูกตีเป็น expired ทั้งที่อายุ ≤14 วันและไม่มีเส้นตาย', v_n = 0, v_n::text);
    select count(*) into v_n from analytics.v_recommendation_inbox where item_kind = 'risk_gate' and shop_id = v_shop;
    select owner_questions into v_n2 from analytics.v_content_inbox_counts where shop_id = v_shop;
    select count(*) into v_n3 from analytics.step_gate g join analytics.campaign_step s on s.id = g.step_id where g.gate_kind = 'risk_owner' and g.status in ('pending', 'blocked') and s.piece_status in ('drafting', 'in_review') and s.shop_id = v_shop;
    v_log := v_log || pg_temp.vb('E4', 'แขน risk_gate = owner_questions (0160) = นับอิสระจาก step_gate', v_n = v_n2 and v_n = v_n3, format('inbox=%s counts=%s ดิบ=%s', v_n, v_n2, v_n3));
    select count(*) into v_n from analytics.v_recommendation_inbox where item_kind = 'campaign_verdict' and shop_id = v_shop;
    v_log := v_log || pg_temp.vb('E5', 'แขน campaign_verdict = แคมเปญที่เสนอแล้วยังไม่ยืนยัน (นับอิสระ) ', v_n = (select count(*) from analytics.campaign where shop_id = v_shop and result_verdict_proposed is not null and result_verdict_confirmed_at is null), v_n::text);
    -- ตัวเลขจริงล้วน (หลังถอยฟิกซ์เจอร์ไม่ได้ — คำนวณจากตารางจริงเพื่อรายงาน)
    select count(*) filter (where owner_action = 'pending' and not (respond_by is null and created_at < now() - interval '14 days')), count(*) filter (where owner_action = 'pending' and created_at < now() - interval '14 days' and respond_by is null),
           count(*) filter (where owner_action = 'done'), count(*) filter (where owner_action = 'rejected')
      into v_n, v_n2, v_n3, v_pend0 from analytics.recommendation_log where title not like 'R9_ %' and title not like 'R90 %' and title not like 'QA %' and title not like 'qa %';
    v_log := v_log || pg_temp.note('E6', format('ข้อเสนอจริงตามตาราง (ไม่รวมฟิกซ์เจอร์): ยังรอตอบในเวลา=%s · เกิน 14 วัน(expired ใน inbox)=%s · done=%s · rejected=%s · risk_gate pending=%s', v_n, v_n2, v_n3, v_pend0,
      (select count(*) from analytics.v_recommendation_inbox where item_kind = 'risk_gate' and shop_id = v_shop)));
    v_t0 := clock_timestamp();
    perform count(*) from analytics.v_recommendation_inbox where shop_id = v_shop and effective_action = 'pending';
    v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
    v_t0 := clock_timestamp();
    perform count(*) from analytics.v_campaign_summary where shop_id = v_shop;
    v_log := v_log || pg_temp.note('E7', format('เวลา inbox (กรองร้าน + pending) %s ms · v_campaign_summary ทั้งร้าน %s ms', round(v_ms), round(extract(epoch from clock_timestamp() - v_t0) * 1000)));
    v_log := v_log || pg_temp.vb('E8', 'service_role อ่าน inbox + v_campaign_summary ได้ · anon/authenticated ไม่มี SELECT',
      pg_temp.ok('service_role', 'select count(*)::text from analytics.v_recommendation_inbox') = 'OK' and pg_temp.ok('service_role', 'select count(*)::text from analytics.v_campaign_summary') = 'OK'
      and not has_table_privilege('anon', 'analytics.v_recommendation_inbox', 'select') and not has_table_privilege('authenticated', 'analytics.v_recommendation_inbox', 'select')
      and not has_table_privilege('anon', 'analytics.v_campaign_summary', 'select') and not has_table_privilege('authenticated', 'analytics.v_campaign_summary', 'select'));
  end if;

  exception when others then
    v_log := v_log || format(E'[FAIL] ABORT qa-0162-extra หยุดกลางทาง sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;
  begin execute 'reset role'; exception when others then null; end;
  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_log := v_log || format(E'\n=== สรุป: [OK] %s · [FAIL] %s — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n', v_ok, v_fail);
  raise exception '%', v_log;
end;
$qa0162$;
