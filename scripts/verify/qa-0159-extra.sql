-- scripts/verify/qa-0159-extra.sql  (QA R2-D2, 7 ต.ค. 69) — เคส "ต้องไม่พัง" + edge ที่ verify-0159 ของ dev ไม่ได้คลุม
--
-- รัน: ต่อ qa-0159-pre.sql (baseline ก่อน migration) + migration + ไฟล์นี้ เป็นไฟล์เดียว แล้วรันแบบไม่ใส่ --commit
--   cat scripts/verify/qa-0159-pre.sql supabase/migrations/0159_content_piece_workflow.sql scripts/verify/qa-0159-extra.sql > tmp.sql
--   node scripts/run-sql.mjs tmp.sql
-- ผลออกทาง raise exception ท้ายไฟล์ (บังคับ ROLLBACK ตาม 3j-migration-traps #11) · [FAIL] ≥ 1 = พบข้อบกพร่อง · [NOTE] = ผ่านแต่ควรรู้
-- ไม่มี pre (รันหลัง apply) → ส่วน D (differential ก่อน/หลัง) ขึ้น [SKIP] · ไฟล์นี้ไม่เคย COMMIT
--
-- กลุ่มเคส:
--   D  differential: RPC เดิมทุกตัว × ทุก artifact/step จริง ผลต้องเท่าก่อน migration (step ที่ piece_status ยัง null) · board md5/คอลัมน์
--   B  backfill 26 แถว: นับซ้ำด้วยวิธีอื่น (regex คนละชุด) · status ไม่ขยับ · confirm_item ตรง marker
--   R  flow จริงบนแถว backfill: อนุมัติ 13 ชิ้น in_review (ตอบ [ต้องยืนยัน] ด้วยอักขระโหด · โครง clip_brief ต้องไม่เพี้ยน) ·
--      LINE จริง 2 แถว approved→posted ไม่มี content_post · แถว piece_kind null 4 แถวต้องมีทางไป posted
--   E  input edge: create/set_plan/advance (ว่าง ZWSP ยาวเกิน emoji ไทย NaN Infinity วันประหลาด ฯลฯ)
--   S  ผลตรวจเก่า vs เนื้อหาใหม่ (cancel/revert แล้วแก้เนื้อหา) · restore ไม่ extract
--   Q  Q8 property test: สุ่ม pick/cancel/restore 80 ครั้ง invariant สัญญาณ↔ชิ้นต้องไม่เพี้ยน
--   L  GUC c2.piece_rpc ไม่ค้าง · เขียนตรงยังโดน guard หลังทุก flow
--   V  v_content_piece: วันไทย · ไม่รั่วชื่อโฮสต์ · hooks · สิทธิ์

create or replace function pg_temp.q_ex(p_sql text, p_expect text[], p_like text default null) returns text
 language plpgsql as $f$
declare v_state text; v_msg text;
begin
  execute p_sql;
  return 'FAIL ผ่านทั้งที่ควรปฏิเสธ';
exception when others then
  get stacked diagnostics v_msg = message_text;
  v_state := sqlstate;
  if v_state = any (p_expect) then
    if p_like is not null and position(p_like in v_msg) = 0 then
      return 'FAIL sqlstate ถูก (' || v_state || ') แต่ข้อความไม่มี "' || p_like || '" → ' || left(v_msg, 160);
    end if;
    return 'OK ' || v_state || ' ' || left(v_msg, 80);
  end if;
  return 'FAIL sqlstate=' || v_state || ' (คาด ' || array_to_string(p_expect, '/') || ') msg=' || left(v_msg, 160);
end $f$;

create or replace function pg_temp.q_ok(p_sql text) returns text
 language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return 'FAIL ควรสำเร็จแต่ตก sqlstate=' || sqlstate || ' msg=' || left(sqlerrm, 200);
end $f$;

-- บรรทัด log จากผล q_ex/q_ok
create or replace function pg_temp.l_(p_id text, p_what text, p_res text) returns text
 language sql as $f$
  select '[' || case when p_res like 'OK%' and p_res not like '%FAIL%' then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what || ' → ' || p_res || E'\n'
$f$;

create or replace function pg_temp.b_(p_id text, p_what text, p_cond boolean, p_detail text default '') returns text
 language sql as $f$
  select '[' || case when p_cond is true then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what
         || case when p_detail <> '' then ' → ' || p_detail else '' end || E'\n'
$f$;

create or replace function pg_temp.n_(p_id text, p_what text) returns text
 language sql as $f$ select '[NOTE] ' || p_id || ' ' || p_what || E'\n' $f$;

create or replace function pg_temp.sk_(p_id text, p_what text) returns text
 language sql as $f$ select '[SKIP] ' || p_id || ' ' || p_what || E'\n' $f$;

create or replace function pg_temp.adv_(p_shop uuid, p_step uuid, p_to text, p_role text, p_reason text default null, p_secs int default null)
 returns text language sql as $f$
  select format('select analytics.content_piece_advance(%L::uuid,%L::uuid,%L,%L,%L,%L::int)', p_shop, p_step, p_to, p_role, p_reason, p_secs)
$f$;

create or replace function pg_temp.plan_(p_shop uuid, p_step uuid, p_set jsonb, p_role text default 'owner')
 returns text language sql as $f$
  select format('select analytics.content_piece_set_plan(%L::uuid,%L::uuid,%L::jsonb,%L)', p_shop, p_step, p_set::text, p_role)
$f$;

create or replace function pg_temp.st_(p_step uuid) returns text
 language sql as $f$
  select piece_status || '/' || status || coalesce('/hold=' || hold_reason, '') from analytics.campaign_step where id = p_step
$f$;

-- แปลง JSON เป็น "โครง": สตริงทุกตัวถูกแทนเป็น "s" — ใช้เทียบว่า resolve ไม่ทำโครง clip_brief เพี้ยน
create or replace function pg_temp.shape_(p_j jsonb) returns text
 language sql immutable as $f$
  select regexp_replace(coalesce(p_j::text, '~'), '"([^"\\]|\\.)*"', '"s"', 'g')
$f$;

-- ชิ้นงานทดสอบ (ผ่าน RPC จริงทั้งหมด) · p_marker = ข้อความ marker ที่จะแทรกใน body/shots
create or replace function pg_temp.mk_(p_shop uuid, p_kind text, p_channel text, p_marker text default null, p_stage text default 'in_review')
 returns uuid language plpgsql as $f$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_s uuid; v_a uuid;
begin
  v_s := analytics.content_piece_create(p_shop, 'qa-0159 ' || substr(gen_random_uuid()::text, 1, 8), p_kind, p_channel,
                                        'jewelry_925', 'owner', v_today + 5);
  if p_stage = 'planned' then return v_s; end if;
  perform analytics.content_piece_advance(p_shop, v_s, 'drafting', 'owner');
  select a.id into v_a from analytics.step_artifact a where a.step_id = v_s;
  if p_kind in ('short_clip', 'live_cut') then
    perform analytics.content_hook_upsert(p_shop, v_s, 'A', 'qa hook A', 'question', null, 'owner', null);
    perform analytics.content_hook_upsert(p_shop, v_s, 'B', 'qa hook B', 'fact', null, 'owner', null);
    perform analytics.campaign_set_artifact_content(v_a, 'qa body' || coalesce(p_marker, ''),
      jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
                         'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'ถ่ายหน้าโต๊ะ' || coalesce(p_marker, '')))));
  else
    perform analytics.campaign_set_artifact_content(v_a, 'qa body' || coalesce(p_marker, ''), null);
  end if;
  if p_stage = 'drafting' then return v_s; end if;
  perform analytics.content_piece_advance(p_shop, v_s, 'in_review', 'owner');
  return v_s;
end $f$;

-- ผ่าน 3 ด่าน (owner) — ไม่ตอบ marker
create or replace function pg_temp.gates_(p_shop uuid, p_step uuid) returns void
 language plpgsql as $f$
begin
  perform analytics.content_gate_record(p_shop, p_step, 'fact_check', 'passed', 'owner',
    jsonb_build_object('sources', jsonb_build_array('https://example.com/qa')));
  perform analytics.content_gate_record(p_shop, p_step, 'brand_rule', 'passed', 'owner');
  perform analytics.content_gate_record(p_shop, p_step, 'risk_owner', 'passed', 'owner');
end $f$;

do $qa0159$
declare
  v_log     text := E'\n=== qa-0159-extra ===\n';
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_shop    uuid;
  v_n       bigint;
  v_n2      bigint;
  v_bad     text;
  v_txt     text;
  v_txt2    text;
  v_r       text;
  v_j       jsonb;
  v_s       uuid;
  v_s2      uuid;
  v_s3      uuid;
  v_a       uuid;
  v_sig     uuid;
  v_pre     record;
  r         record;
  r2        record;
  v_i       int;
  v_fail    int;
  v_ok      int;
  v_note    int;
  v_posts0  bigint;
  v_answers text[] := array[
    'ราคา 925 \1 & $1 "x" 😀',
    E'บรรทัด1\nบรรทัด2\tแท็บ',
    'C:\temp\new\\x',
    '"ใน quote"',
    '[ราคา] (ทดสอบ) {a} *b* ^c$ |d| ?e +f',
    'ก็ ๆ ๛ ฿ ½ — – … ’ “ ”'];
  v_ans     text;
  v_before  text;
  v_after   text;
  v_has_pre boolean;
begin
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select count(*) into v_n from public.shop;
  if v_n <> 1 then raise exception 'qa-0159: ต้องมีร้านเดียว (พบ %)', v_n; end if;
  select id into v_shop from public.shop;
  select count(*) into v_posts0 from analytics.content_post;
  v_has_pre := to_regclass('pg_temp.qa_probe') is not null;

  ----------------------------------------------------------------------------
  -- D. differential: RPC เดิม × ทุกแถวจริง ก่อน/หลัง migration
  ----------------------------------------------------------------------------
  if not v_has_pre then
    v_log := v_log || pg_temp.sk_('D', 'ไม่มี qa-0159-pre.sql ในไฟล์เดียวกัน — ข้ามเคส differential ทั้งก้อน (ต้องรันก่อน apply เท่านั้นจึงมี baseline)');
  else
    perform pg_temp.qa_probe_all('post');
    perform pg_temp.qa_life_all('post');
    select * into v_pre from qa_pre_misc;
    select count(*) into v_n from qa_probe where phase = 'pre';
    select count(*) into v_n2 from qa_probe where phase = 'post';
    v_log := v_log || pg_temp.b_('D0', 'จำนวน probe ก่อน = หลัง (' || v_n || ')', v_n = v_n2 and v_n > 600);

    -- step ที่ piece_status ยัง null (24 แถวก่อน ต.ค. + แถวสร้างใหม่ในรอบ probe) · sid null = ops สร้างงาน
    select count(*), string_agg(distinct p.op || '[' || p.arg || ']', ', ') into v_n, v_bad
      from qa_probe p join qa_probe q on q.phase = 'post' and q.op = p.op and q.arg = p.arg
       and q.sid is not distinct from p.sid and q.aid is not distinct from p.aid
      left join analytics.campaign_step s on s.id = p.sid
     where p.phase = 'pre' and p.outcome is distinct from q.outcome and (p.sid is null or s.piece_status is null);
    v_log := v_log || pg_temp.b_('D1', 'RPC เดิม (set_status ทุกค่า · set_content · ai_draft · toggle_shot · reschedule · delete · content_type · pass_gate · create_task/template) บน step ที่ไม่อยู่ใน workflow: ผลเท่าก่อน migration ทุกแถว',
      v_n = 0, 'ต่าง ' || v_n || ' แถว: ' || coalesce(left(v_bad, 300), ''));
    if v_n > 0 then
      for r in select p.op, p.arg, left(p.outcome, 80) as pre_o, left(q.outcome, 80) as post_o
                 from qa_probe p join qa_probe q on q.phase = 'post' and q.op = p.op and q.arg = p.arg
                  and q.sid is not distinct from p.sid and q.aid is not distinct from p.aid
                 left join analytics.campaign_step s on s.id = p.sid
                where p.phase = 'pre' and p.outcome is distinct from q.outcome and (p.sid is null or s.piece_status is null) limit 5 loop
        v_log := v_log || format(E'    ต่าง: %s [%s] ก่อน=%s หลัง=%s\n', r.op, r.arg, r.pre_o, r.post_o);
      end loop;
    end if;

    -- step ที่อยู่ใน workflow: ทุกความต่างต้องเป็น 55000 (guard ตั้งใจ) เท่านั้น
    select count(*) into v_n
      from qa_probe p join qa_probe q on q.phase = 'post' and q.op = p.op and q.arg = p.arg
       and q.sid is not distinct from p.sid and q.aid is not distinct from p.aid
      join analytics.campaign_step s on s.id = p.sid
     where p.phase = 'pre' and p.outcome is distinct from q.outcome and s.piece_status is not null and q.outcome not like '55000:%';
    v_log := v_log || pg_temp.b_('D2', 'step ใน workflow ใหม่: ความต่างจากเดิมทุกแถวเป็น 55000 เท่านั้น (ไม่มี error แปลก/500)', v_n = 0, 'แถวที่ต่างแต่ไม่ใช่ 55000: ' || v_n);
    for r in select p.op, p.arg, count(*) n
               from qa_probe p join qa_probe q on q.phase = 'post' and q.op = p.op and q.arg = p.arg
                and q.sid is not distinct from p.sid and q.aid is not distinct from p.aid
               join analytics.campaign_step s on s.id = p.sid
              where p.phase = 'pre' and p.outcome is distinct from q.outcome and s.piece_status is not null
              group by 1, 2 order by 1, 2 loop
      v_log := v_log || format(E'    [info] ถูก guard 55000 (ตั้งใจ): %s [%s] × %s แถว\n', r.op, r.arg, r.n);
    end loop;

    -- "ต้องไม่พัง" บน step ต.ค. (26 แถว): ops เหล่านี้ห้ามต่างเลย
    select count(*), string_agg(distinct p.op, ',') into v_n, v_bad
      from qa_probe p join qa_probe q on q.phase = 'post' and q.op = p.op and q.arg = p.arg
       and q.sid is not distinct from p.sid and q.aid is not distinct from p.aid
      join analytics.campaign_step s on s.id = p.sid
     where p.phase = 'pre' and p.outcome is distinct from q.outcome and s.piece_status is not null
       and p.op in ('reschedule', 'toggle_shot', 'set_content_type', 'pass_gate', 'set_content_body', 'set_content_brief_same', 'ai_draft', 'delete_step');
    v_log := v_log || pg_temp.b_('D3', 'step ต.ค. (planned/in_review): เลื่อนวัน/ติ๊ก shot/ประเภท content/แก้เนื้อหา/AI ร่าง/ลบ — ผลเท่าเดิมทุกแถว (K5/K6 เมื่อยังไม่อนุมัติ)',
      v_n = 0, 'ต่าง ' || v_n || ' แถว ops=' || coalesce(v_bad, ''));

    -- board
    select c into v_txt from qa_pre_cols;
    select string_agg(column_name || ':' || data_type, ',' order by ordinal_position) into v_txt2
      from information_schema.columns where table_schema = 'analytics' and table_name = 'v_campaign_board';
    v_log := v_log || pg_temp.b_('D4', 'v_campaign_board คอลัมน์/ชนิด/ลำดับเท่าเดิม', v_txt = v_txt2);
    select count(*) into v_n from qa_pre_board p left join analytics.v_campaign_board b on b.step_id = p.step_id
     where to_jsonb(b)::text is distinct from p.t;
    select count(*) into v_n2 from analytics.v_campaign_board;
    v_log := v_log || pg_temp.b_('D5', 'v_campaign_board ทั้ง 50 แถว (รวม step ต.ค. 26) เนื้อหาทุกคอลัมน์เท่าก่อน apply (step 24 แถวก่อน ต.ค. + 26 แถว ต.ค.)',
      v_n = 0 and v_n2 = (select count(*) from qa_pre_board), 'ต่าง ' || v_n || ' · แถวใน view ' || v_n2);
    select count(*) into v_n from analytics.v_campaign_board b join analytics.campaign_step s on s.id = b.step_id
     where s.piece_status is not null and b.resolved_start >= date '2026-10-01';
    v_log := v_log || pg_temp.b_('D6', 'step ต.ค. 26 แถวโผล่บนบอร์ดเดิมครบ (resolved_start ≥ 2026-10-01 และ piece_status ไม่ null)', v_n = 26, 'พบ ' || v_n);
    v_log := v_log || pg_temp.b_('D7', 'v_content_entry_queue / v_content_post_t7 / v_campaign_calendar ผลเท่าเดิม',
      (select md5(coalesce(string_agg(q::text, E'\n' order by q::text), '')) from analytics.v_content_entry_queue q) = v_pre.queue_md5
      and (select md5(coalesce(string_agg(t::text, E'\n' order by t::text), '')) from analytics.v_content_post_t7 t) = v_pre.t7_md5
      and (select md5(coalesce(string_agg(c::text, E'\n' order by c::text), '')) from analytics.v_campaign_calendar c) = v_pre.cal_md5);
    v_log := v_log || pg_temp.b_('D8', 'step/artifact md5 (id,status,[body,brief],updated_at) เท่าก่อน apply — ตรวจอิสระจากด่านท้ายไฟล์ของ dev',
      (select md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), ';' order by id), '')) from analytics.campaign_step) = v_pre.step_md5
      and (select md5(coalesce(string_agg(concat_ws('|', id, status, content_body, clip_brief::text, updated_at), ';' order by id), '')) from analytics.step_artifact) = v_pre.art_md5);
    v_log := v_log || pg_temp.b_('D9', 'จำนวนแถว campaign/step/artifact/gate/post เท่าเดิม (ไม่มีแถวหลุดจาก probe)',
      (select count(*) from analytics.campaign) = v_pre.n_campaign and (select count(*) from analytics.campaign_step) = v_pre.n_step
      and (select count(*) from analytics.step_artifact) = v_pre.n_art and (select count(*) from analytics.step_gate) = v_pre.n_gate
      and (select count(*) from analytics.content_post) = v_pre.n_post);

    -- D13 (รอบ 2): วงจรเต็มของ step ที่สร้างใหม่ (create_task/template × ก่อน ต.ค./ต.ค./พ.ย.) ภายใต้ role service_role — ผลทุก op + piece_status เท่าก่อน migration
    select count(*), string_agg(left(p.arg, 40), ', ') into v_n, v_bad
      from qa_probe p join qa_probe q on q.phase = 'post' and q.op = 'life' and q.arg = p.arg
     where p.phase = 'pre' and p.op = 'life' and p.outcome is distinct from q.outcome;
    select count(*) into v_n2 from qa_probe where phase = 'post' and op = 'life';
    v_log := v_log || pg_temp.b_('D13', 'วงจรเต็ม (สร้าง→AI ร่างซ้ำ→สถานะ artifact ทุกค่า→แก้เนื้อหา→AI ร่างหลังคนแก้→brief→ติ๊ก shot→content_type→gate→เลื่อน→ลบ) บน step ใหม่ ' || v_n2 || ' ชุด ภายใต้ service_role: ผลเท่าก่อน migration ทุกชุด',
      v_n = 0 and v_n2 >= 9, 'ต่าง ' || v_n || ' ชุด: ' || coalesce(v_bad, ''));
    select count(*) into v_n from qa_probe
     where phase = 'post' and op = 'life'
       and (outcome not like 'create=OK;%' or outcome like '%55000%' or outcome like '%content_%' or outcome !~ '|ps=(-,)+$' or outcome not like '%ai1=OK;ai2=OK;%' or outcome not like '%set_body=OK;%');
    v_log := v_log || pg_temp.b_('D13b', 'ผล life หลัง migration ไม่มี 55000/ข้อความของ workflow ใหม่ · สร้างสำเร็จ · AI ร่างซ้ำ/แก้เนื้อหาสำเร็จ · step ใหม่ทุกตัว piece_status = null (ไม่ถูกดูดเข้า workflow)',
      v_n = 0, 'ผิดปกติ ' || v_n || ' ชุด');
  end if;

  -- 24 แถวก่อน ต.ค. ทุกคอลัมน์ใหม่ null (K1) · gate เดิม 12 แถวยังเป็นชนิดเดิม
  select count(*) into v_n from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
   where c.anchor_date + s.offset_start_days < date '2026-10-01'
     and (s.piece_status is not null or s.hold_reason is not null or s.piece_kind is not null or s.time_slot is not null
          or s.customer_group is not null or s.hypothesis is not null or s.metric_code is not null or s.baseline_value is not null
          or s.pass_threshold is not null or s.baseline_spread is not null or s.baseline_as_of is not null or s.baseline_note is not null
          or s.pass_op is not null or s.footage_status is not null or s.footage_url is not null or s.shoot_note is not null
          or s.shoot_location is not null or s.shoot_minutes_est is not null or s.shoot_date is not null or s.expected_host_id is not null
          or s.drafted_by_ai is not null or s.line_audience is not null or s.line_audience_reason is not null);
  v_log := v_log || pg_temp.b_('D10', 'step ก่อน 1 ต.ค. ทุกคอลัมน์ใหม่ของ 0159 เป็น null', v_n = 0, 'แถวที่ไม่ null: ' || v_n);
  select count(*) into v_n from analytics.step_gate where gate_kind in ('fact_check', 'brand_rule', 'risk_owner') or detail is not null or checked_by_role is not null;
  v_log := v_log || pg_temp.b_('D11', 'step_gate เดิม 12 แถว: ไม่มีแถว/ค่าของ kind ใหม่งอกขึ้นเอง', v_n = 0, 'พบ ' || v_n);

  ----------------------------------------------------------------------------
  -- B. backfill: นับซ้ำด้วยวิธีอื่น
  ----------------------------------------------------------------------------
  select count(*) into v_n from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
   where c.anchor_date + s.offset_start_days >= date '2026-10-01' and s.piece_status is not null;
  select count(*) into v_n2 from analytics.campaign_step s where s.piece_status is not null;
  v_log := v_log || pg_temp.b_('B1', 'step ที่มี piece_status = 26 พอดี และทั้งหมดอยู่ตั้งแต่ 1 ต.ค. (ไม่มีแถวเก่าหลุดเข้า workflow)', v_n = 26 and v_n2 = 26, v_n || '/' || v_n2);
  select count(*) filter (where s.piece_status = 'planned'), count(*) filter (where s.piece_status = 'in_review') into v_n, v_n2
    from analytics.campaign_step s where s.piece_status is not null;
  v_log := v_log || pg_temp.b_('B2', '13 planned + 13 in_review', v_n = 13 and v_n2 = 13, v_n || '/' || v_n2);
  select count(*) into v_n from analytics.campaign_step where piece_status is not null and status <> 'todo';
  v_log := v_log || pg_temp.b_('B3', 'status เดิมของ 26 แถวยัง todo (backfill ไม่ขยับ projection)', v_n = 0, 'ไม่ใช่ todo: ' || v_n);
  select count(*) into v_n from analytics.campaign_step s join analytics.step_artifact a on a.step_id = s.id
   where s.piece_status = 'in_review' and not (s.drafted_by_ai is true and a.generated_by = 'ai_copywriter' and a.status = 'draft_pending_review');
  select count(*) into v_n2 from analytics.campaign_step s join analytics.step_artifact a on a.step_id = s.id
   where s.piece_status = 'planned' and not (s.drafted_by_ai is false and a.status = 'todo');
  v_log := v_log || pg_temp.b_('B4', 'in_review ⇔ AI ร่างรอตรวจ (drafted_by_ai=true) · planned ⇔ todo/คนเขียน (drafted_by_ai=false) ตรงกับ artifact ทุกแถว',
    v_n = 0 and v_n2 = 0, 'ผิด in_review=' || v_n || ' planned=' || v_n2);
  select count(*) into v_n from analytics.campaign_step s join analytics.step_artifact a on a.step_id = s.id
   where s.piece_status is not null and s.piece_kind is distinct from
     case a.artifact_type when 'short_form_clip' then 'short_clip' when 'fb_post' then 'ig_fb_post'
                          when 'broadcast_script_line' then 'line_message' else null end;
  v_log := v_log || pg_temp.b_('B5', 'piece_kind ตรงตาราง artifact_type ทุกแถว (teaser_image/parcel_card = null ไม่เดา)', v_n = 0, 'ผิด ' || v_n);
  select count(*) into v_n from analytics.campaign_step where piece_status is not null and piece_kind is null;
  v_log := v_log || pg_temp.b_('B5b', 'แถว piece_kind null = 4 (teaser 3 + parcel 1)', v_n = 4, 'พบ ' || v_n);
  select count(*) into v_n from analytics.campaign_step where piece_kind = 'line_message' and line_audience is not null;
  v_log := v_log || pg_temp.b_('B6', 'LINE 2 แถว line_audience = null (ห้ามแต่งเหตุผลให้)', v_n = 0 and (select count(*) from analytics.campaign_step where piece_kind = 'line_message') = 2);
  select count(*) into v_n from analytics.step_gate;
  v_log := v_log || pg_temp.b_('B7', 'backfill ไม่สร้าง step_gate (ยัง 12)', v_n = 12, 'พบ ' || v_n);
  select count(*) into v_n from analytics.content_piece_event e
   where e.event_kind = 'create' and e.actor_role = 'system' and e.payload ->> 'backfill' = '0159';
  select count(*) into v_n2 from analytics.content_piece_event where event_kind <> 'create';
  v_log := v_log || pg_temp.b_('B8', 'event create ของ backfill = 26 (actor system) · event อื่นมีเฉพาะ confirm (จาก extract 11 ชิ้น) ไม่มีเหตุการณ์แปลกปลอม', v_n = 26
    and v_n2 = (select count(*) from analytics.content_piece_event where event_kind = 'confirm') and v_n2 = 11, 'create=' || v_n || ' อื่น=' || v_n2);

  -- นับ marker ใหม่ด้วย regex คนละชุด (ไม่ใช้ helper ของ dev): คำถามไม่ซ้ำต่อ step เทียบ content_confirm_item
  with q as (
    select a.step_id,
           btrim(regexp_replace(m[1], '\s+', ' ', 'g')) as q
      from analytics.step_artifact a,
           regexp_matches(coalesce(a.clip_brief::text, '') || ' ' || coalesce(a.content_body, ''), '\[ต้องยืนยัน\s*:?\s*([^\]]*)\]', 'g') as m
     where a.step_id in (select id from analytics.campaign_step where piece_status is not null)),
  mine as (select step_id, count(distinct q) as n from q group by step_id),
  theirs as (select step_id, count(*) as n from analytics.content_confirm_item where removed_at is null group by step_id)
  select count(*) filter (where m.n is distinct from t.n), count(*), (select count(distinct step_id) from analytics.content_confirm_item)
    into v_n, v_n2, v_i
    from mine m full join theirs t using (step_id);
  v_log := v_log || pg_temp.b_('B9', 'content_confirm_item ต่อ step = จำนวนคำถามไม่ซ้ำที่นับเองด้วย regex อิสระ (ต่าง ' || v_n || ' step จาก ' || v_n2 || ') · step ที่มีรายการ = ' || v_i,
    v_n = 0 and v_i = 11);
  select count(*) into v_n from analytics.content_confirm_item where resolved_at is not null or answer is not null;
  v_log := v_log || pg_temp.b_('B10', 'รายการ marker หลัง backfill ยังไม่มีใครตอบ (resolved=0)', v_n = 0);

  ----------------------------------------------------------------------------
  -- R. flow จริงบนแถว backfill (ทุกอย่างอยู่ในทรานแซกชัน → rollback)
  ----------------------------------------------------------------------------
  -- R1: อนุมัติ 13 ชิ้น in_review จริง ตอบ [ต้องยืนยัน] ด้วยอักขระโหด · โครง clip_brief ต้องไม่เพี้ยน
  v_i := 0; v_bad := '';
  for r in select s.id, s.title from analytics.campaign_step s where s.piece_status = 'in_review' order by s.id loop
    v_i := v_i + 1;
    begin
      select pg_temp.shape_(a.clip_brief), a.id into v_before, v_a from analytics.step_artifact a where a.step_id = r.id;
      perform pg_temp.gates_(v_shop, r.id);
      v_n := 0;
      for r2 in select i.id from analytics.content_confirm_item i where i.step_id = r.id and i.resolved_at is null and i.removed_at is null order by i.created_at, i.id loop
        v_ans := v_answers[1 + (v_n % array_length(v_answers, 1))];
        v_n := v_n + 1;
        perform analytics.content_confirm_resolve(v_shop, r2.id, v_ans, 'owner');
      end loop;
      select pg_temp.shape_(a.clip_brief) into v_after from analytics.step_artifact a where a.id = v_a;
      if v_before is distinct from v_after then v_bad := v_bad || ' shape:' || left(r.id::text, 8); end if;
      if exists (select 1 from analytics.step_artifact a where a.step_id = r.id
                  and (analytics.content_marker_present(a.content_body) or analytics.content_marker_present(a.clip_brief::text))) then
        v_bad := v_bad || ' marker:' || left(r.id::text, 8);
      end if;
      -- คำตอบที่ cleaned แล้วต้องอยู่ในข้อความจริงอย่างน้อย 1 ที่ (ในเนื้อหาหรือสตริงใด ๆ ใน clip_brief)
      if exists (
        select 1 from analytics.content_confirm_item i
         where i.step_id = r.id and i.answer is not null
           and not exists (
             select 1 from analytics.step_artifact a
              where a.step_id = r.id and (position(i.answer in coalesce(a.content_body, '')) > 0
                or exists (select 1 from jsonb_path_query(coalesce(a.clip_brief, '{}'::jsonb), 'strict $.**') as x
                            where jsonb_typeof(x) = 'string' and position(i.answer in (x #>> '{}')) > 0)))) then
        v_bad := v_bad || ' answer-missing:' || left(r.id::text, 8);
      end if;
      perform analytics.assert_clip_brief_valid(a.clip_brief) from analytics.step_artifact a where a.id = v_a and a.clip_brief is not null;
      if not (select can_approve from analytics.v_content_piece where step_id = r.id) then v_bad := v_bad || ' can_approve=false:' || left(r.id::text, 8); end if;
      perform analytics.content_piece_advance(v_shop, r.id, 'approved', 'owner', null, 30);
    exception when others then
      v_bad := v_bad || ' ERR(' || sqlstate || '):' || left(r.id::text, 8) || ' ' || left(sqlerrm, 90);
    end;
  end loop;
  select count(*) into v_n from analytics.campaign_step s join analytics.step_artifact a on a.step_id = s.id
   where s.piece_status = 'approved' and s.status = 'active' and a.status = 'approved';
  v_log := v_log || pg_temp.b_('R1', 'อนุมัติ 13 ชิ้น in_review จริง: ตอบ marker ด้วยอักขระโหด (\1 & $1 " \ [] ** emoji ขึ้นบรรทัดใหม่) → โครง clip_brief ไม่เพี้ยน · ไม่เหลือ marker · คำตอบอยู่ในข้อความจริง · อนุมัติผ่านครบ (approved/active/artifact approved = ' || v_n || '/13)',
    v_bad = '' and v_n = 13 and v_i = 13, 'ปัญหา:' || v_bad);

  -- R2: LINE จริง 2 แถว planned → … → approved → posted (ไม่ต้องมีลิงก์ · ไม่สร้าง content_post)
  v_bad := ''; v_i := 0;
  for r in select s.id, s.audience_segment, s.title from analytics.campaign_step s where s.piece_kind = 'line_message' and s.piece_status = 'planned' order by s.id loop
    v_i := v_i + 1;
    begin
      perform analytics.content_piece_set_plan(v_shop, r.id,
        case when r.audience_segment is not null
             then jsonb_build_object('line_audience', 'segment', 'line_audience_reason', 'เชิญกลุ่มพิเศษ ทดสอบ QA')
             else jsonb_build_object('line_audience', 'all') end, 'owner');
      perform analytics.content_piece_advance(v_shop, r.id, 'drafting', 'owner');
      select a.id, a.content_body into v_a, v_txt from analytics.step_artifact a where a.step_id = r.id;
      if v_txt is null or v_txt !~ '\S' then
        -- เอกสารว่าง: ส่งตรวจต้องถูกปฏิเสธก่อน แล้วเจ้าของเขียนเนื้อหาจึงผ่าน
        v_r := pg_temp.q_ex(pg_temp.adv_(v_shop, r.id, 'in_review', 'owner'), array['55000'], 'ยังไม่มีเนื้อหา');
        if v_r not like 'OK%' then v_bad := v_bad || ' empty-body-not-blocked:' || left(r.id::text, 8) || '=' || left(v_r, 60); end if;
        perform analytics.campaign_set_artifact_content(v_a, 'ข้อความ LINE ทดสอบ QA', null);
      end if;
      perform analytics.content_piece_advance(v_shop, r.id, 'in_review', 'owner');
      perform pg_temp.gates_(v_shop, r.id);
      for r2 in select i.id from analytics.content_confirm_item i where i.step_id = r.id and i.resolved_at is null and i.removed_at is null loop
        perform analytics.content_confirm_resolve(v_shop, r2.id, 'ตอบทดสอบ', 'owner');
      end loop;
      perform analytics.content_piece_advance(v_shop, r.id, 'approved', 'owner', null, 20);
      perform analytics.content_piece_advance(v_shop, r.id, 'posted', 'owner');
      if not (select s.piece_status = 'posted' and s.status = 'done' from analytics.campaign_step s where s.id = r.id) then v_bad := v_bad || ' state:' || left(r.id::text, 8); end if;
      if not exists (select 1 from analytics.step_artifact a where a.step_id = r.id and a.status = 'done') then v_bad := v_bad || ' artifact-not-done:' || left(r.id::text, 8); end if;
      if (select b.effective_status from analytics.v_campaign_board b where b.step_id = r.id) is distinct from 'done' then v_bad := v_bad || ' board-not-done:' || left(r.id::text, 8); end if;
      if (select effective_piece_status from analytics.v_content_piece where step_id = r.id) is distinct from 'posted' then v_bad := v_bad || ' view-not-posted:' || left(r.id::text, 8); end if;
    exception when others then
      v_bad := v_bad || ' ERR(' || sqlstate || '):' || left(r.id::text, 8) || ' ' || left(sqlerrm, 100);
    end;
  end loop;
  select count(*) into v_n from analytics.content_post;
  v_log := v_log || pg_temp.b_('R2', 'LINE จริง 2 แถว: set_plan audience → drafting → in_review → 3 ด่าน → approved → posted ตรง ไม่มีลิงก์ · ไม่สร้าง content_post (' || v_posts0 || '→' || v_n || ') · status done · บอร์ดเดิม done',
    v_bad = '' and v_i = 2 and v_n = v_posts0, 'ปัญหา:' || v_bad);

  -- R3: แถว piece_kind null 4 แถว (teaser/parcel) ต้องมีทางไป posted — ไม่งั้นถูกขังใน planned ถาวร
  v_bad := ''; v_i := 0;
  for r in select s.id, s.channel from analytics.campaign_step s where s.piece_kind is null and s.piece_status = 'planned' order by s.id loop
    v_i := v_i + 1;
    begin
      v_r := pg_temp.q_ok(pg_temp.adv_(v_shop, r.id, 'drafting', 'owner'));
      if v_r <> 'OK' then v_bad := v_bad || ' drafting:' || left(r.id::text, 8) || '=' || left(v_r, 60); continue; end if;
      -- อนุมัติทั้งที่ kind null ต้องถูกบล็อก (X7) แล้วตั้ง kind ผ่าน set_plan
      perform analytics.content_piece_set_plan(v_shop, r.id,
        jsonb_build_object('piece_kind', 'story') ||
        case when r.channel is null or r.channel in ('facebook', 'instagram') then '{}'::jsonb else jsonb_build_object('channel', 'instagram') end, 'owner');
      select a.id, a.content_body into v_a, v_txt from analytics.step_artifact a where a.step_id = r.id limit 1;
      if v_a is null then v_bad := v_bad || ' no-artifact:' || left(r.id::text, 8); continue; end if;
      if v_txt is null or v_txt !~ '\S' then perform analytics.campaign_set_artifact_content(v_a, 'ข้อความ story ทดสอบ QA', null); end if;
      perform analytics.content_piece_advance(v_shop, r.id, 'in_review', 'owner');
      perform pg_temp.gates_(v_shop, r.id);
      for r2 in select i.id from analytics.content_confirm_item i where i.step_id = r.id and i.resolved_at is null and i.removed_at is null loop
        perform analytics.content_confirm_resolve(v_shop, r2.id, 'x', 'owner');
      end loop;
      perform analytics.content_piece_advance(v_shop, r.id, 'approved', 'owner', null, 20);
      perform analytics.content_piece_advance(v_shop, r.id, 'posted', 'owner');
      if (select piece_status from analytics.campaign_step where id = r.id) <> 'posted' then v_bad := v_bad || ' not-posted:' || left(r.id::text, 8); end if;
    exception when others then
      v_bad := v_bad || ' ERR(' || sqlstate || '):' || left(r.id::text, 8) || ' ' || left(sqlerrm, 100);
    end;
  end loop;
  v_log := v_log || pg_temp.b_('R3', 'แถว piece_kind null 4 แถว: ตั้ง kind=story ผ่าน set_plan แล้วเดินถึง posted ได้ (artifact เดิม teaser_image/parcel_card ใช้ต่อ — ไม่ถูกขังใน planned)',
    v_bad = '' and v_i = 4, 'แถว ' || v_i || ' ปัญหา:' || v_bad);

  -- D12: flow เดิมที่ "สร้างแล้วแก้เนื้อหา" บน step ใหม่ที่ไม่อยู่ใน workflow (AddPlanForm / แผนจาก template / AI ร่าง) ต้องใช้ได้
  --      (K7 ของสเปกบอกแค่ "ยังสร้างได้" — ไม่ได้ทดสอบว่าแก้เนื้อหาต่อได้)
  begin
    v_s := analytics.campaign_create_task(v_shop, 'qa D12 task', v_today + 40, 'fb_post', null, null, null);
    select a.id into v_a from analytics.step_artifact a where a.step_id = v_s;
    v_log := v_log || pg_temp.l_('D12a', 'campaign_create_task (artifact fb_post) แล้ว campaign_set_artifact_content บน artifact ที่เพิ่งสร้าง → สำเร็จ',
      pg_temp.q_ok(format('select analytics.campaign_set_artifact_content(%L::uuid, %L, null)', v_a, 'แก้เนื้อหา step ที่สร้างจากฟอร์มเดิม')));
    v_s2 := analytics.campaign_create_task(v_shop, 'qa D12 task 2', v_today + 41, 'short_form_clip', null, null, null);
    select a.id into v_a from analytics.step_artifact a where a.step_id = v_s2;
    v_log := v_log || pg_temp.l_('D12b', 'step ใหม่จาก AddPlanForm (artifact ยังไม่มีคนแก้) → AI ร่าง (campaign_ai_draft_artifact) สำเร็จ',
      pg_temp.q_ok(format('select analytics.campaign_ai_draft_artifact(%L::uuid, %L, null, %L)', v_a, 'ร่างโดย AI รอบแรก', 'qa-model')));
    v_n := 0; v_bad := '';
    v_s3 := analytics.campaign_create_from_template(v_shop, 'promo_event_5step', v_today + 60, null, null);
    for r in select a.id from analytics.step_artifact a join analytics.campaign_step s on s.id = a.step_id where s.campaign_id = v_s3 loop
      v_r := pg_temp.q_ok(format('select analytics.campaign_ai_draft_artifact(%L::uuid, %L, null, %L)', r.id, 'ร่างโดย AI', 'qa-model'));
      v_n := v_n + 1;
      if v_r <> 'OK' then v_bad := v_bad || ' ' || left(v_r, 90); end if;
    end loop;
    v_log := v_log || pg_temp.b_('D12c', 'แคมเปญใหม่จาก template (promo_event_5step): AI ร่างทุก artifact (' || v_n || ' ตัว) สำเร็จ — บน step ที่ไม่อยู่ใน workflow', v_bad = '' and v_n > 0, 'ล้ม:' || left(v_bad, 300));
  exception when others then
    v_log := v_log || format(E'[FAIL] D12 ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- E. input edge
  ----------------------------------------------------------------------------
  select pg_temp.mk_(v_shop, 'short_clip', 'tiktok', null, 'planned') into v_s;
  select pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'planned') into v_s2;

  -- create
  v_log := v_log || pg_temp.l_('E1a', 'create ชื่อ null → 22023', pg_temp.q_ex(format('select analytics.content_piece_create(%L::uuid, null, ''short_clip'', ''tiktok'', ''jewelry_925'', ''owner'', null)', v_shop), array['22023']));
  v_log := v_log || pg_temp.l_('E1b', 'create ชื่อ ZWSP/bidi ล้วน → 22023', pg_temp.q_ex(format('select analytics.content_piece_create(%L::uuid, %L, ''short_clip'', ''tiktok'', ''jewelry_925'', ''owner'', null)', v_shop, chr(8203) || chr(8206) || '  ' || chr(65279)), array['22023']));
  v_log := v_log || pg_temp.l_('E1c', 'create ชื่อ 201 ตัวอักษร → 22023', pg_temp.q_ex(format('select analytics.content_piece_create(%L::uuid, %L, ''short_clip'', ''tiktok'', ''jewelry_925'', ''owner'', null)', v_shop, repeat('ก', 201)), array['22023']));
  v_log := v_log || pg_temp.l_('E1d', 'create ชื่อ 200 ตัวอักษรไทย+emoji ผ่าน', pg_temp.q_ok(format('select analytics.content_piece_create(%L::uuid, %L, ''short_clip'', ''tiktok'', ''jewelry_925'', ''owner'', null)', v_shop, repeat('ก😀', 100))));
  v_log := v_log || pg_temp.l_('E1e', 'create actor null → ถูกปฏิเสธ (ไม่ใช่ผ่านเงียบ)', pg_temp.q_ex(format('select analytics.content_piece_create(%L::uuid, ''t'', ''short_clip'', ''tiktok'', ''jewelry_925'', null, null)', v_shop), array['22023', '42501']));
  v_log := v_log || pg_temp.l_('E1f', 'create actor "OWNER" (ตัวใหญ่) / "admin" → ถูกปฏิเสธ', pg_temp.q_ex(format('select analytics.content_piece_create(%L::uuid, ''t'', ''short_clip'', ''tiktok'', ''jewelry_925'', ''OWNER'', null)', v_shop), array['22023', '42501']));
  v_log := v_log || pg_temp.l_('E1g', 'create kind "SHORT_CLIP" (ตัวใหญ่) → 22023', pg_temp.q_ex(format('select analytics.content_piece_create(%L::uuid, ''t'', ''SHORT_CLIP'', ''tiktok'', ''jewelry_925'', ''owner'', null)', v_shop), array['22023']));
  v_log := v_log || pg_temp.l_('E1h', 'create วัน infinity → 22023 (ไม่ทำให้ view บอร์ดพังทั้งหน้า)', pg_temp.q_ex(format('select analytics.content_piece_create(%L::uuid, ''t'', ''short_clip'', ''tiktok'', ''jewelry_925'', ''owner'', ''infinity''::date)', v_shop), array['22023']));
  v_log := v_log || pg_temp.l_('E1i', 'create วัน 1900-01-01 และ วันนี้+1101 → 22023', pg_temp.q_ex(format('select analytics.content_piece_create(%L::uuid, ''t'', ''short_clip'', ''tiktok'', ''jewelry_925'', ''owner'', %L::date)', v_shop, date '1900-01-01'), array['22023'])
    || pg_temp.q_ex(format('select analytics.content_piece_create(%L::uuid, ''t'', ''short_clip'', ''tiktok'', ''jewelry_925'', ''owner'', %L::date)', v_shop, v_today + 1101), array['22023']));
  v_log := v_log || pg_temp.l_('E1j', 'create วัน = วันนี้ (ขอบล่างที่ใช้งานจริง) ผ่าน · เวลาไทย', pg_temp.q_ok(format('select analytics.content_piece_create(%L::uuid, ''t'', ''short_clip'', ''tiktok'', ''jewelry_925'', ''owner'', %L::date)', v_shop, v_today)));

  -- set_plan
  v_log := v_log || pg_temp.l_('E2a', 'set_plan p_set เป็น array / string / json null / sql null → 22023', pg_temp.q_ex(pg_temp.plan_(v_shop, v_s, '[]'::jsonb), array['22023'])
    || pg_temp.q_ex(pg_temp.plan_(v_shop, v_s, '"x"'::jsonb), array['22023'])
    || pg_temp.q_ex(pg_temp.plan_(v_shop, v_s, 'null'::jsonb), array['22023'])
    || pg_temp.q_ex(format('select analytics.content_piece_set_plan(%L::uuid, %L::uuid, null::jsonb, ''owner'')', v_shop, v_s), array['22023']));
  v_bad := null;
  for r in select * from (values
    ('baseline_value', '"Infinity"'), ('baseline_value', '"-Infinity"'), ('baseline_value', '"NaN"'), ('baseline_value', '10000000000000'),
    ('baseline_value', '-10000000000000'), ('baseline_value', 'true'), ('baseline_value', '[]'), ('baseline_value', '{}'),
    ('baseline_spread', '-1'), ('pass_threshold', '"1e400"'),
    ('hypothesis', '"' || repeat('ก', 1001) || '"'), ('hypothesis', '"' || chr(8203) || '"'), ('hypothesis', '"   "'), ('hypothesis', '123'),
    ('shoot_minutes_est', '2147483648'), ('shoot_minutes_est', '1.5'), ('shoot_minutes_est', '0'), ('shoot_minutes_est', '601'), ('shoot_minutes_est', '"abc"'),
    ('start_time', '"25:00"'), ('start_time', '"7pm"'), ('date', '"2026-02-30"'), ('date', 'null'), ('date', '20261010'), ('date', '"2026-10-10T10:00:00"'),
    ('baseline_as_of', '"2999-01-01"'), ('shoot_date', '"2026-13-01"'),
    ('footage_url', '"javascript:alert(1)"'), ('footage_url', '"http://u:p@example.com/"'), ('footage_url', '"https://example.com/a b"'),
    ('footage_url', '"ftp://example.com/x"'), ('footage_url', '"' || 'https://example.com/' || repeat('a', 2100) || '"'),
    ('expected_host_id', '"not-a-uuid"'), ('expected_host_id', '"00000000-0000-4000-8000-000000000000"'),
    ('piece_kind', '"banana"'), ('metric_code', '"SAVE_RATE"'), ('line_audience', '"segment"'), ('time_slot', '5'), ('hypotesis', '"typo"')
  ) as t(k, v) loop
    v_r := pg_temp.q_ex(pg_temp.plan_(v_shop, v_s, jsonb_build_object(r.k, r.v::jsonb)), array['22023']);
    if v_r not like 'OK%' then
      v_bad := coalesce(v_bad, '') || format(' [%s=%s → %s]', r.k, left(r.v, 30), left(v_r, 70));
    end if;
  end loop;
  v_log := v_log || pg_temp.b_('E2b', 'set_plan ค่าผิดรูป 39 แบบ (NaN/Infinity/1e13/เกินช่วง/ZWSP/วันที่ไม่มีจริง/URL อันตราย/uuid ปลอม/typo key) ทุกแบบ = 22023 ไม่ใช่ 500/ผ่านเงียบ', v_bad is null, coalesce(v_bad, ''));
  v_bad := null;
  v_log := v_log || pg_temp.l_('E2c', 'set_plan ค่าถูกขอบ: hypothesis 1000 ไทย · shoot_minutes_est "600" (string) · baseline_value 0 · ล้างด้วย null',
    pg_temp.q_ok(pg_temp.plan_(v_shop, v_s, jsonb_build_object('hypothesis', repeat('ก', 1000), 'shoot_minutes_est', '600', 'baseline_value', 0, 'metric_code', 'save_rate', 'pass_op', '>=', 'pass_threshold', 0.5))));
  perform analytics.content_piece_set_plan(v_shop, v_s, jsonb_build_object('hypothesis', 'ข้อความทดสอบ', 'baseline_value', 0, 'metric_code', 'save_rate', 'pass_threshold', 1, 'pass_op', '>='), 'owner');
  select count(*) into v_n from analytics.content_piece_event where step_id = v_s and event_kind = 'plan';
  perform analytics.content_piece_set_plan(v_shop, v_s, jsonb_build_object('hypothesis', 'ข้อความทดสอบ', 'baseline_value', 0.0, 'metric_code', 'save_rate', 'pass_threshold', 1.00, 'pass_op', '>='), 'owner');
  select count(*) into v_n2 from analytics.content_piece_event where step_id = v_s and event_kind = 'plan';
  v_log := v_log || pg_temp.b_('E2d', 'set_plan ค่าเดิมซ้ำ (0 vs 0.0, 1 vs 1.00) = ไม่เกิด event plan ใหม่ (idempotent · ไม่ท่วม timeline)', v_n = v_n2, v_n || '→' || v_n2);
  v_log := v_log || pg_temp.b_('E2e', 'baseline_value = 0 ถูกเก็บเป็น 0 ไม่ใช่ null (trap #13)', (select baseline_value = 0 and baseline_value is not null from analytics.campaign_step where id = v_s));
  v_j := analytics.content_piece_set_plan(v_shop, v_s, '{}'::jsonb, 'owner');
  v_log := v_log || pg_temp.b_('E2f', 'set_plan {} = ไม่แก้อะไร คืน changed []', v_j -> 'changed' = '[]'::jsonb, v_j::text);

  -- advance
  v_log := v_log || pg_temp.l_('E3a', 'cancel เหตุผล ZWSP ล้วน / 2 ตัวอักษร / 501 ตัวอักษร → 22023', pg_temp.q_ex(pg_temp.adv_(v_shop, v_s2, 'cancelled', 'owner', chr(8203) || chr(8203) || chr(8203)), array['22023'])
    || pg_temp.q_ex(pg_temp.adv_(v_shop, v_s2, 'cancelled', 'owner', 'ab'), array['22023'])
    || pg_temp.q_ex(pg_temp.adv_(v_shop, v_s2, 'cancelled', 'owner', repeat('ก', 501)), array['22023']));
  v_log := v_log || pg_temp.l_('E3b', 'advance p_to null / "" / " drafting" (เว้นวรรค) / "DRAFTING" → 22023', pg_temp.q_ex(format('select analytics.content_piece_advance(%L::uuid,%L::uuid,null,''owner'')', v_shop, v_s2), array['22023'])
    || pg_temp.q_ex(pg_temp.adv_(v_shop, v_s2, '', 'owner'), array['22023'])
    || pg_temp.q_ex(pg_temp.adv_(v_shop, v_s2, ' drafting', 'owner'), array['22023'])
    || pg_temp.q_ex(pg_temp.adv_(v_shop, v_s2, 'DRAFTING', 'owner'), array['22023']));
  v_log := v_log || pg_temp.l_('E3c', 'advance review_seconds −1 / 86401 บน approved ที่ไม่ถึงสถานะ → ถูกปฏิเสธก่อนแตะข้อมูล', pg_temp.q_ex(pg_temp.adv_(v_shop, v_s2, 'approved', 'owner', null, -1), array['22023', '55000'])
    || pg_temp.q_ex(pg_temp.adv_(v_shop, v_s2, 'approved', 'owner', null, 86401), array['22023', '55000']));
  v_log := v_log || pg_temp.b_('E3d', 'หลังชุดปฏิเสธข้างบน ชิ้นยัง planned/scheduled ไม่ขยับ', pg_temp.st_(v_s2) = 'planned/scheduled', pg_temp.st_(v_s2));

  -- เปลี่ยน piece_kind ภายหลัง
  select pg_temp.mk_(v_shop, 'line_message', 'line_oa', null, 'planned') into v_s3;
  v_r := pg_temp.q_ex(pg_temp.plan_(v_shop, v_s3, jsonb_build_object('piece_kind', 'story', 'channel', 'instagram')), array['22023']);
  v_log := v_log || pg_temp.n_('E4a', 'เปลี่ยน line_message → story ด้วย set_plan ตรงๆ ถูกปฏิเสธ 22023 เพราะ line_audience="all" (ค่าอัตโนมัติ) ค้างอยู่ — ต้องส่ง line_audience:null มาด้วยเสมอ: ' || left(v_r, 110));
  v_r := pg_temp.q_ok(pg_temp.plan_(v_shop, v_s3, jsonb_build_object('piece_kind', 'story', 'channel', 'instagram', 'line_audience', null)));
  select a.artifact_type into v_txt from analytics.step_artifact a where a.step_id = v_s3;
  v_log := v_log || pg_temp.n_('E4b', 'หลังเปลี่ยน kind เป็น story แล้ว (ส่ง line_audience:null) ผล=' || v_r || ' · artifact เดิมคงชนิด ' || coalesce(v_txt, 'null') || ' (ไม่เปลี่ยนตาม kind — เอกสารชนิด broadcast_script_line ใต้ชิ้น story)');

  ----------------------------------------------------------------------------
  -- S. ผลตรวจเก่า vs เนื้อหาใหม่ (ด่าน "ร่างใหม่แล้วผลตรวจเก่าต้องตก" ต้องครอบทุกสถานะที่แก้เนื้อหาได้ ไม่ใช่แค่ drafting/in_review)
  ----------------------------------------------------------------------------
  begin
    -- S1a: in_review + 3 ด่านผ่าน → cancel → แก้เนื้อหา → ผลตรวจ fact/brand ต้องตกเป็น pending
    select pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'in_review') into v_s;
    perform pg_temp.gates_(v_shop, v_s);
    select id into v_a from analytics.step_artifact where step_id = v_s;
    perform analytics.content_piece_advance(v_shop, v_s, 'cancelled', 'owner', 'ทดสอบยกเลิก');
    perform analytics.campaign_set_artifact_content(v_a, 'เนื้อหาใหม่หลังยกเลิก ราคาเปลี่ยนแล้ว', null);
    select string_agg(gate_kind || '=' || status, ',' order by gate_kind) into v_txt from analytics.step_gate where step_id = v_s;
    v_log := v_log || pg_temp.b_('S1a', 'แก้เนื้อหาขณะ cancelled → ผลตรวจ fact_check/brand_rule ต้องตกเป็น pending (เนื้อหาเปลี่ยน ผลเดิมใช้ไม่ได้)',
      (select count(*) from analytics.step_gate where step_id = v_s and gate_kind in ('fact_check', 'brand_rule') and status = 'pending') = 2,
      'ได้จริง: ' || v_txt);
  exception when others then
    v_log := v_log || format(E'[FAIL] S1a ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  begin
    -- S1b: cancel → แก้เนื้อหา → restore → approve ต้องถูกปฏิเสธ
    select pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'in_review') into v_s;
    perform pg_temp.gates_(v_shop, v_s);
    select id into v_a from analytics.step_artifact where step_id = v_s;
    perform analytics.content_piece_advance(v_shop, v_s, 'cancelled', 'owner', 'ทดสอบยกเลิก');
    perform analytics.campaign_set_artifact_content(v_a, 'เนื้อหาใหม่หลังยกเลิก ราคาเปลี่ยนแล้ว', null);
    perform analytics.content_piece_advance(v_shop, v_s, 'restore', 'owner', 'กู้คืนทดสอบ');
    v_r := pg_temp.q_ok(pg_temp.adv_(v_shop, v_s, 'approved', 'owner', null, 10));
    v_log := v_log || pg_temp.b_('S1b', 'cancel → แก้เนื้อหา → restore → approve: ต้องถูกปฏิเสธ (ผลตรวจเก่าไม่ครอบเนื้อหาใหม่) — ถ้า OK = อนุมัติด้วยผลตรวจเก่า',
      v_r <> 'OK', 'approve ได้ผล: ' || left(v_r, 120));
  exception when others then
    v_log := v_log || format(E'[FAIL] S1b ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  begin
    -- S2: in_review ผ่านด่าน → drafting → planned (revert) → แก้เนื้อหาที่ planned → drafting → in_review → approve
    select pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'in_review') into v_s;
    perform pg_temp.gates_(v_shop, v_s);
    select id into v_a from analytics.step_artifact where step_id = v_s;
    perform analytics.content_piece_advance(v_shop, v_s, 'drafting', 'owner', 'ส่งกลับแก้');
    perform analytics.content_piece_advance(v_shop, v_s, 'planned', 'owner');
    perform analytics.campaign_set_artifact_content(v_a, 'เนื้อหาใหม่ตอน planned — เปลี่ยนไปเยอะ', null);
    perform analytics.content_piece_advance(v_shop, v_s, 'drafting', 'owner');
    perform analytics.content_piece_advance(v_shop, v_s, 'in_review', 'owner');
    select string_agg(gate_kind || '=' || status, ',' order by gate_kind) into v_txt from analytics.step_gate where step_id = v_s;
    v_r := pg_temp.q_ok(pg_temp.adv_(v_shop, v_s, 'approved', 'owner', null, 10));
    v_log := v_log || pg_temp.b_('S2', 'ส่งกลับถึง planned แล้วแก้เนื้อหา แล้วส่งตรวจใหม่: ผลตรวจเก่า (fact/brand) ต้องไม่ถูกใช้อนุมัติเนื้อหาใหม่',
      v_r <> 'OK', 'gates=' || v_txt || ' · approve ได้ผล: ' || left(v_r, 120));
  exception when others then
    v_log := v_log || format(E'[FAIL] S2 ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  begin
    -- S3: restore ไม่ extract: cancel → เพิ่ม marker → restore → ต้องมีรายการให้ตอบ
    select pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'in_review') into v_s;
    select id into v_a from analytics.step_artifact where step_id = v_s;
    perform analytics.content_piece_advance(v_shop, v_s, 'cancelled', 'owner', 'ทดสอบยกเลิก');
    perform analytics.campaign_set_artifact_content(v_a, 'เนื้อหามีจุดที่ยังไม่แน่ใจ [ต้องยืนยัน: ราคาวันนี้เท่าไร]', null);
    perform analytics.content_piece_advance(v_shop, v_s, 'restore', 'owner', 'กู้คืนทดสอบ');
    select confirm_pending, confirm_marker_in_text into r from analytics.v_content_piece where step_id = v_s;
    v_log := v_log || pg_temp.b_('S3', 'restore ชิ้นที่เพิ่ม [ต้องยืนยัน] ขณะ cancelled: ต้องมีรายการให้เจ้าของตอบ (confirm_pending ≥ 1) เมื่อ marker อยู่ในข้อความ',
      not (r.confirm_marker_in_text and r.confirm_pending = 0), 'confirm_pending=' || r.confirm_pending || ' marker_in_text=' || r.confirm_marker_in_text);
    perform analytics.content_confirm_extract(v_shop, v_s, 'system');
    select confirm_pending into v_n from analytics.v_content_piece where step_id = v_s;
    v_log := v_log || pg_temp.b_('S3b', 'content_confirm_extract (เรียกมือ) เก็บรายการที่หลุดได้ → confirm_pending=1', v_n = 1, 'ได้ ' || v_n);
  exception when others then
    v_log := v_log || format(E'[FAIL] S3 ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;


  begin
  ----------------------------------------------------------------------------
  -- Q. Q8 property test (สุ่มแบบกำหนด seed): pick / cancel / restore 80 ครั้ง
  ----------------------------------------------------------------------------
  perform setseed(0.42);
  insert into analytics.content_signal (shop_id, kind, source, seen_on, summary)
    values (v_shop, 'craft_moment', 'owner', v_today, 'qa-0159 Q8 property') returning id into v_sig;
  declare
    v_pieces uuid[] := '{}';
    v_pick   uuid;
    v_op     int;
    v_k      int;
    v_stat   text;
    v_ps     uuid;
    v_viol   text := '';
    v_pc     text;
    v_ops    text := '';
  begin
    for v_i in 1..80 loop
      v_op := floor(random() * 3)::int;
      select status, picked_step_id into v_stat, v_ps from analytics.content_signal where id = v_sig;
      begin
        if v_op = 0 and v_stat = 'new' then
          v_pick := analytics.content_signal_pick(v_shop, v_sig, 'qa Q8 ' || v_i, 'short_clip', 'tiktok', 'jewelry_925', 'owner');
          v_pieces := v_pieces || v_pick; v_ops := v_ops || 'P';
        elsif v_op = 1 and cardinality(v_pieces) > 0 then
          v_k := 1 + floor(random() * cardinality(v_pieces))::int;
          perform analytics.content_piece_advance(v_shop, v_pieces[v_k], 'cancelled', 'owner', 'qa cancel ' || v_i);
          v_ops := v_ops || 'C';
        elsif v_op = 2 and cardinality(v_pieces) > 0 then
          v_k := 1 + floor(random() * cardinality(v_pieces))::int;
          perform analytics.content_piece_advance(v_shop, v_pieces[v_k], 'restore', 'owner', 'qa restore ' || v_i);
          v_ops := v_ops || 'R';
        end if;
      exception when sqlstate '55000' then
        v_ops := v_ops || 'x';   -- ปฏิเสธตามกติกา (เช่น cancel ซ้ำ · restore ที่ไม่ได้ cancel · pick ที่ picked อยู่)
      end;
      select status, picked_step_id into v_stat, v_ps from analytics.content_signal where id = v_sig;
      if v_stat = 'picked' then
        select piece_status into v_pc from analytics.campaign_step where id = v_ps;
        if v_ps is null or v_pc is null or v_pc = 'cancelled' then
          v_viol := v_viol || format(' #%s signal=picked แต่ชิ้นที่ชี้=%s', v_i, coalesce(v_pc, 'null'));
        end if;
      elsif v_stat = 'new' and v_ps is not null then
        v_viol := v_viol || format(' #%s signal=new แต่ยังผูก picked_step_id', v_i);
      end if;
    end loop;
    v_log := v_log || pg_temp.b_('Q', 'Q8 property: สัญญาณ picked ⇒ ชี้ชิ้นที่ยังไม่ cancelled เสมอ · new ⇒ ไม่ผูกชิ้น (80 ops: ' || v_ops || ')', v_viol = '', left(v_viol, 400));
  end;
  exception when others then
    v_log := v_log || format(E'[FAIL] Q ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  begin
  ----------------------------------------------------------------------------
  -- N. regression จากรอบแก้ 7 ต.ค. 69 (QA รอบ 2): ล้างผลตรวจเมื่อเนื้อหาเปลี่ยน · step นอก workflow ไม่ถูกแตะ · content_type · K5 ·
  --    restore→in_review→อนุมัติซ้ำ · role จริง (service_role) กับ guard ที่ผูก current_user
  ----------------------------------------------------------------------------
  select code into v_txt2 from analytics.content_type where is_active order by code limit 1;

  -- N1: AI ร่างซ้ำ / คนแก้ / hook เปลี่ยน บนชิ้น in_review ที่ผ่าน 3 ด่านแล้ว
  begin
    v_s := analytics.content_piece_create(v_shop, 'qa-0159 N1 ' || substr(gen_random_uuid()::text, 1, 6), 'ig_fb_post', 'facebook', 'jewelry_925', 'owner', v_today + 5);
    perform analytics.content_piece_advance(v_shop, v_s, 'drafting', 'owner');
    select a.id into v_a from analytics.step_artifact a where a.step_id = v_s;
    perform analytics.campaign_ai_draft_artifact(v_a, 'ร่างโดย AI รอบแรก', null, 'qa-model');
    perform analytics.content_piece_advance(v_shop, v_s, 'in_review', 'owner');
    perform pg_temp.gates_(v_shop, v_s);
    select count(*) into v_n from analytics.step_gate where step_id = v_s and status = 'passed';
    perform analytics.campaign_ai_draft_artifact(v_a, 'ร่างโดย AI รอบสอง ราคาเปลี่ยนแล้ว', null, 'qa-model');
    select count(*) into v_n2 from analytics.step_gate where step_id = v_s and status = 'pending';
    select string_agg(gate_kind || '=' || status, ',' order by gate_kind) into v_txt from analytics.step_gate where step_id = v_s;
    v_log := v_log || pg_temp.b_('N1a', 'in_review ผ่าน 3 ด่าน (ก่อนร่างผ่าน ' || v_n || ') → AI ร่างซ้ำ: ผลตรวจถูกล้างเป็น pending ครบ 3 ด่านรวม risk_owner',
      v_n = 3 and v_n2 = 3, v_txt);
    v_log := v_log || pg_temp.b_('N1b', 'หลัง AI ร่างซ้ำ: ชิ้นยัง in_review (ไม่ถูกดีด) · event gate reset 1 รายการระบุ 3 ด่าน · can_approve = false',
      (select piece_status from analytics.campaign_step where id = v_s) = 'in_review'
      and (select count(*) from analytics.content_piece_event where step_id = v_s and event_kind = 'gate' and payload ->> 'reset' = 'true'
                and jsonb_array_length(payload -> 'gate_kinds') = 3) = 1
      and (select can_approve from analytics.v_content_piece where step_id = v_s) is false);
    v_log := v_log || pg_temp.l_('N1c', 'หลัง AI ร่างซ้ำ: อนุมัติด้วยผลตรวจเก่าไม่ได้ (55000)', pg_temp.q_ex(pg_temp.adv_(v_shop, v_s, 'approved', 'owner', null, 10), array['55000']));
    perform pg_temp.gates_(v_shop, v_s);
    v_log := v_log || pg_temp.b_('N1d', 'ตรวจ 3 ด่านใหม่ → can_approve = true แล้วอนุมัติได้ (ล้างแล้วไม่ได้ขังถาวร)',
      (select can_approve from analytics.v_content_piece where step_id = v_s) is true
      and pg_temp.q_ok(pg_temp.adv_(v_shop, v_s, 'approved', 'owner', null, 10)) = 'OK');

    -- คนแก้เนื้อหา (campaign_set_artifact_content) บน in_review
    v_s2 := pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'in_review');
    perform pg_temp.gates_(v_shop, v_s2);
    select id into v_a from analytics.step_artifact where step_id = v_s2;
    perform analytics.campaign_set_artifact_content(v_a, 'คนแก้ข้อความหลังผ่านด่านแล้ว', null);
    select count(*) into v_n from analytics.step_gate where step_id = v_s2 and status = 'pending';
    v_log := v_log || pg_temp.b_('N1e', 'in_review ผ่าน 3 ด่าน → คนแก้เนื้อหา: ผลตรวจตกเป็น pending ครบ 3', v_n = 3, 'pending=' || v_n);

    -- hook: เปลี่ยน label ล้วน = ถ้อยคำเดิม ผลตรวจยังอยู่ · เปลี่ยน text = ล้าง
    v_s3 := pg_temp.mk_(v_shop, 'short_clip', 'tiktok', null, 'in_review');
    perform pg_temp.gates_(v_shop, v_s3);
    select h.id into v_sig from analytics.content_hook h where h.step_id = v_s3 and h.label = 'A';
    perform analytics.content_hook_upsert(v_shop, v_s3, 'A', 'qa hook A', 'warning', null, 'owner', v_sig);
    select count(*) into v_n from analytics.step_gate where step_id = v_s3 and status = 'passed';
    v_log := v_log || pg_temp.b_('N1f', 'hook เปลี่ยน hook_type ล้วน (text เดิม) → ผลตรวจ 3 ด่านยังผ่าน (ถ้อยคำไม่เปลี่ยน)', v_n = 3, 'passed=' || v_n);
    perform analytics.content_hook_upsert(v_shop, v_s3, 'A', 'qa hook A แก้ถ้อยคำ', 'warning', null, 'owner', v_sig);
    select count(*) into v_n from analytics.step_gate where step_id = v_s3 and status = 'pending';
    v_log := v_log || pg_temp.b_('N1g', 'hook เปลี่ยน text → ผลตรวจตกเป็น pending ครบ 3', v_n = 3, 'pending=' || v_n);
  exception when others then
    v_log := v_log || format(E'[FAIL] N1 ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  -- N2: step นอก workflow (piece_status null) — แก้เนื้อหา/hook ต้องไม่แตะ step_gate เดิม · ไม่สร้าง event · ทำได้ตามเดิม (ย้อนกลับท้าย block)
  begin
    begin
      select md5(coalesce(string_agg(g::text, '|' order by g::text), '')), count(*) filter (where g.status <> 'pending')
        into v_before, v_n
        from analytics.step_gate g join analytics.campaign_step s on s.id = g.step_id where s.piece_status is null;
      v_i := 0;
      for r in select a.id from analytics.step_artifact a join analytics.campaign_step s on s.id = a.step_id where s.piece_status is null order by a.id loop
        perform analytics.campaign_set_artifact_content(r.id, 'qa N2 แก้เนื้อหา ' || v_i, null);
        v_i := v_i + 1;
      end loop;
      select s.id into v_s from analytics.campaign_step s where s.piece_status is null order by s.id limit 1;
      v_r := pg_temp.q_ok(format('select analytics.content_hook_upsert(%L::uuid, %L::uuid, ''A'', ''qa N2 hook'', ''question'', null, ''owner'', null)', v_shop, v_s));
      select md5(coalesce(string_agg(g::text, '|' order by g::text), '')) into v_after
        from analytics.step_gate g join analytics.campaign_step s on s.id = g.step_id where s.piece_status is null;
      select count(*) into v_n2 from analytics.content_piece_event e join analytics.campaign_step s on s.id = e.step_id where s.piece_status is null;
      raise exception 'qa_n2' using errcode = 'QA003';
    exception when sqlstate 'QA003' then null;
    end;
    v_log := v_log || pg_temp.b_('N2', 'step นอก workflow: แก้เนื้อหา ' || v_i || ' artifact + เพิ่ม hook → step_gate เดิม (' || v_n || ' แถวที่ไม่ pending) ไม่ถูกแตะ · ไม่มี event ใหม่ · hook upsert ' || v_r,
      v_i >= 20 and v_n > 0 and v_before = v_after and v_n2 = 0 and v_r = 'OK',
      'md5 ' || (v_before = v_after)::text || ' · events=' || v_n2);
  exception when others then
    v_log := v_log || format(E'[FAIL] N2 ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  -- N3: campaign_step_set_content_type — ทำได้ในทุกที่ที่ทำได้ก่อน 0159 (ก่อน ต.ค. · step ใหม่ ต.ค. · planned · in_review) · ล็อกเฉพาะ approved+
  begin
    select s.id into v_s from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
     where s.piece_status is null and c.anchor_date + s.offset_start_days < date '2026-10-01' order by s.id limit 1;
    v_log := v_log || pg_temp.l_('N3a', 'set_content_type บน step ก่อน 1 ต.ค. (นอก workflow)',
      pg_temp.q_ok(format('select analytics.campaign_step_set_content_type(%L::uuid, %L::uuid, %L)', v_shop, v_s, v_txt2)));
    v_s2 := analytics.campaign_create_task(v_shop, 'qa N3', date '2026-10-20', 'fb_post', null, null, null);
    v_log := v_log || pg_temp.l_('N3b', 'set_content_type บน step ใหม่วันที่ ต.ค. จาก AddPlanForm (นอก workflow)',
      pg_temp.q_ok(format('select analytics.campaign_step_set_content_type(%L::uuid, %L::uuid, %L)', v_shop, v_s2, v_txt2)));
    v_s3 := pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'planned');
    v_log := v_log || pg_temp.l_('N3c', 'set_content_type บนชิ้น planned ใน workflow',
      pg_temp.q_ok(format('select analytics.campaign_step_set_content_type(%L::uuid, %L::uuid, %L)', v_shop, v_s3, v_txt2)));
    v_s3 := pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'in_review');
    v_log := v_log || pg_temp.l_('N3d', 'set_content_type บนชิ้น in_review ใน workflow',
      pg_temp.q_ok(format('select analytics.campaign_step_set_content_type(%L::uuid, %L::uuid, %L)', v_shop, v_s3, v_txt2)));
    perform pg_temp.gates_(v_shop, v_s3);
    perform analytics.content_piece_advance(v_shop, v_s3, 'approved', 'owner', null, 10);
    select code into v_txt from analytics.content_type where is_active and code is distinct from v_txt2 order by code limit 1;
    v_log := v_log || pg_temp.l_('N3e', 'set_content_type บนชิ้นที่อนุมัติแล้ว → 55000 (ล็อกตามตั้งใจ)',
      pg_temp.q_ex(format('select analytics.campaign_step_set_content_type(%L::uuid, %L::uuid, %L)', v_shop, v_s3, v_txt), array['55000']));
    v_log := v_log || pg_temp.b_('N3f', 'ค่า content_type ของชิ้นอนุมัติแล้วไม่ถูกเปลี่ยนจากความพยายามเมื่อกี้',
      (select content_type_code from analytics.campaign_step where id = v_s3) is not distinct from v_txt2);
    perform analytics.content_piece_advance(v_shop, v_s3, 'in_review', 'owner', 'ส่งกลับแก้ประเภท');
    v_log := v_log || pg_temp.l_('N3g', 'ส่งกลับ in_review แล้ว set_content_type ทำได้อีก',
      pg_temp.q_ok(format('select analytics.campaign_step_set_content_type(%L::uuid, %L::uuid, %L)', v_shop, v_s3, v_txt)));
  exception when others then
    v_log := v_log || format(E'[FAIL] N3 ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  -- N4 (K5): ชิ้นที่อนุมัติแล้ว (จริง 13 ชิ้นจาก R1) — ติ๊ก shot/เลื่อนวัน ทำได้ · ไม่ล้างผลตรวจ · ไม่ดีดสถานะ · เนื้อหาไม่เปลี่ยน
  begin
    select s.id, a.id into v_s, v_a from analytics.campaign_step s join analytics.step_artifact a on a.step_id = s.id
     where s.piece_status = 'approved' and s.piece_kind = 'short_clip' and jsonb_typeof(a.clip_brief -> 'shots') = 'array'
       and jsonb_array_length(a.clip_brief -> 'shots') > 0 order by s.id limit 1;
    if v_s is null then
      v_log := v_log || pg_temp.sk_('N4', 'ไม่มี short_clip approved ให้ทดสอบ (R1 ไม่ได้ทำงาน?)');
    else
      select a.clip_brief -> 'shots' -> 0 ->> 'id', a.content_body into v_txt, v_txt2 from analytics.step_artifact a where a.id = v_a;
      select md5(coalesce(string_agg(g::text, '|' order by g::text), '')) into v_before from analytics.step_gate g where g.step_id = v_s;
      select md5(coalesce(a.content_body, '') || analytics.content_piece_brief_norm(a.clip_brief)::text) into v_txt from analytics.step_artifact a where a.id = v_a;
      select count(*) into v_n from analytics.content_piece_event where step_id = v_s;
      select a.clip_brief -> 'shots' -> 0 ->> 'id' into v_ans from analytics.step_artifact a where a.id = v_a;
      v_log := v_log || pg_temp.l_('N4a', 'ติ๊ก shot (done=true) บน short_clip ที่อนุมัติแล้ว → สำเร็จ',
        pg_temp.q_ok(format('select analytics.campaign_toggle_clip_shot(%L::uuid, %L, true)', v_a, v_ans)));
      perform analytics.campaign_toggle_clip_shot(v_a, v_ans, true);
      perform analytics.campaign_toggle_clip_shot(v_a, v_ans, false);
      select md5(coalesce(string_agg(g::text, '|' order by g::text), '')) into v_after from analytics.step_gate g where g.step_id = v_s;
      v_log := v_log || pg_temp.b_('N4b', 'หลังติ๊ก/เลิกติ๊ก: ยัง approved · ผลตรวจ 3 ด่านไม่ถูกแตะ · ไม่มี event ใหม่ · เนื้อหา (ไม่นับ done) เท่าเดิม',
        (select piece_status from analytics.campaign_step where id = v_s) = 'approved'
        and v_before = v_after
        and (select count(*) from analytics.content_piece_event where step_id = v_s) = v_n
        and (select md5(coalesce(a.content_body, '') || analytics.content_piece_brief_norm(a.clip_brief)::text) from analytics.step_artifact a where a.id = v_a) = v_txt);
      v_log := v_log || pg_temp.l_('N4c', 'เลื่อนวัน (campaign_reschedule_step) บนชิ้นที่อนุมัติแล้ว → สำเร็จ',
        pg_temp.q_ok(format('select analytics.campaign_reschedule_step(%L::uuid, %L::date, null, true)', v_s,
          (select c.anchor_date + st.offset_start_days + 1 from analytics.campaign_step st join analytics.campaign c on c.id = st.campaign_id where st.id = v_s))));
      v_log := v_log || pg_temp.l_('N4d', 'แก้เนื้อหาบนชิ้นที่อนุมัติแล้ว → 55000 (ล็อกตามตั้งใจ — ต้องไม่เปิดช่องจากการแก้ K5)',
        pg_temp.q_ex(format('select analytics.campaign_set_artifact_content(%L::uuid, %L, null)', v_a, 'แก้หลังอนุมัติ'), array['55000']));
    end if;
  exception when others then
    v_log := v_log || format(E'[FAIL] N4 ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  -- N5: restore จาก cancelled ที่ยกเลิกมาจาก approved → ลง in_review (H1) แล้วอนุมัติซ้ำได้ครบวงจร
  begin
    -- A: อนุมัติ → ยกเลิก → กู้ (ไม่แก้เนื้อหา)
    v_s := pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'in_review');
    perform pg_temp.gates_(v_shop, v_s);
    perform analytics.content_piece_advance(v_shop, v_s, 'approved', 'owner', null, 10);
    perform analytics.content_piece_advance(v_shop, v_s, 'cancelled', 'owner', 'ยกเลิกทดสอบ');
    perform analytics.content_piece_advance(v_shop, v_s, 'restore', 'owner', 'กู้คืนทดสอบ');
    v_log := v_log || pg_temp.b_('N5a', 'approved → cancelled → restore: ลง in_review/active (ไม่กลับ approved ตรง) · artifact ไม่ใช่ approved · event restore มี forced_review',
      pg_temp.st_(v_s) = 'in_review/active'
      and (select status from analytics.step_artifact where step_id = v_s) in ('draft', 'draft_pending_review')
      and exists (select 1 from analytics.content_piece_event where step_id = v_s and event_kind = 'restore' and payload ->> 'forced_review' = 'true'),
      pg_temp.st_(v_s));
    v_log := v_log || pg_temp.b_('N5b1', 'หลัง restore (ผลตรวจเดิมยังใช้ได้ เพราะไม่ได้แก้เนื้อหา): can_approve = true',
      (select can_approve from analytics.v_content_piece where step_id = v_s) is true);
    v_r := pg_temp.q_ok(pg_temp.adv_(v_shop, v_s, 'approved', 'owner', null, 10));
    v_log := v_log || pg_temp.b_('N5b2', 'กดอนุมัติซ้ำสำเร็จ → approved/active + artifact approved', v_r = 'OK' and pg_temp.st_(v_s) = 'approved/active'
      and (select status from analytics.step_artifact where step_id = v_s) = 'approved',
      v_r || ' st=' || pg_temp.st_(v_s) || ' art=' || (select status from analytics.step_artifact where step_id = v_s));

    -- B: อนุมัติ → ยกเลิก → แก้เนื้อหา → กู้ → อนุมัติด้วยผลเก่าไม่ได้ → ตรวจใหม่ → อนุมัติได้
    v_s2 := pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'in_review');
    perform pg_temp.gates_(v_shop, v_s2);
    perform analytics.content_piece_advance(v_shop, v_s2, 'approved', 'owner', null, 10);
    perform analytics.content_piece_advance(v_shop, v_s2, 'cancelled', 'owner', 'ยกเลิกทดสอบ');
    select id into v_a from analytics.step_artifact where step_id = v_s2;
    perform analytics.campaign_set_artifact_content(v_a, 'เนื้อหาใหม่หลังยกเลิกจากอนุมัติ ราคาเปลี่ยน', null);
    perform analytics.content_piece_advance(v_shop, v_s2, 'restore', 'owner', 'กู้คืนทดสอบ');
    v_log := v_log || pg_temp.b_('N5c', 'approved → cancelled → แก้เนื้อหา → restore: in_review · ผลตรวจ 3 ด่าน pending · อนุมัติด้วยผลเก่าไม่ได้ (55000)',
      pg_temp.st_(v_s2) = 'in_review/active'
      and (select count(*) from analytics.step_gate where step_id = v_s2 and status = 'pending') = 3
      and pg_temp.q_ex(pg_temp.adv_(v_shop, v_s2, 'approved', 'owner', null, 10), array['55000']) like 'OK%');
    perform pg_temp.gates_(v_shop, v_s2);
    v_log := v_log || pg_temp.l_('N5d', 'ตรวจ 3 ด่านใหม่แล้ว → อนุมัติได้ (ครบวงจร)', pg_temp.q_ok(pg_temp.adv_(v_shop, v_s2, 'approved', 'owner', null, 10)));

    -- C: อนุมัติ → ยกเลิก → แทรก [ต้องยืนยัน] → กู้ → ต้องมีรายการให้ตอบ → ตอบ → ตรวจใหม่ → อนุมัติได้
    v_s3 := pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'in_review');
    perform pg_temp.gates_(v_shop, v_s3);
    perform analytics.content_piece_advance(v_shop, v_s3, 'approved', 'owner', null, 10);
    perform analytics.content_piece_advance(v_shop, v_s3, 'cancelled', 'owner', 'ยกเลิกทดสอบ');
    select id into v_a from analytics.step_artifact where step_id = v_s3;
    perform analytics.campaign_set_artifact_content(v_a, 'เนื้อหามีจุดไม่แน่ใจ [ต้องยืนยัน: ราคาแพ็กเกจ]', null);
    perform analytics.content_piece_advance(v_shop, v_s3, 'restore', 'owner', 'กู้คืนทดสอบ');
    select count(*) into v_n from analytics.content_confirm_item where step_id = v_s3 and resolved_at is null and removed_at is null;
    v_log := v_log || pg_temp.b_('N5e', 'approved → cancelled → แทรก [ต้องยืนยัน] → restore: มีรายการให้ตอบ 1 · อนุมัติไม่ได้', v_n = 1
      and pg_temp.q_ex(pg_temp.adv_(v_shop, v_s3, 'approved', 'owner', null, 10), array['55000']) like 'OK%', 'pending=' || v_n);
    select id into v_sig from analytics.content_confirm_item where step_id = v_s3 and resolved_at is null and removed_at is null;
    perform analytics.content_confirm_resolve(v_shop, v_sig, 'ราคา 1,290 บาท', 'owner');
    perform pg_temp.gates_(v_shop, v_s3);
    v_log := v_log || pg_temp.b_('N5f', 'ตอบ [ต้องยืนยัน] + ตรวจใหม่ → อนุมัติได้ · ข้อความจริงมีคำตอบ ไม่มี marker',
      pg_temp.q_ok(pg_temp.adv_(v_shop, v_s3, 'approved', 'owner', null, 10)) = 'OK'
      and (select position('ราคา 1,290 บาท' in content_body) > 0 and not analytics.content_marker_present(content_body) from analytics.step_artifact where step_id = v_s3));

    -- D: hold บนชิ้น in_review ที่พร้อม → can_approve ต้อง false (สูตรรวม hold ใน view)
    v_s2 := pg_temp.mk_(v_shop, 'ig_fb_post', 'facebook', null, 'in_review');
    perform pg_temp.gates_(v_shop, v_s2);
    v_n := (select count(*) from analytics.v_content_piece where step_id = v_s2 and can_approve);
    perform analytics.content_piece_advance(v_shop, v_s2, 'hold', 'owner', 'รอถ่ายภาพเพิ่ม');
    v_log := v_log || pg_temp.b_('N5g', 'in_review พร้อม → can_approve true · หลัง hold → false (และ resume กลับเป็น true)',
      v_n = 1 and (select can_approve from analytics.v_content_piece where step_id = v_s2) is false
      and (select count(*) from analytics.v_content_piece p where p.step_id = v_s2 and p.can_approve) = 0
      , 'can_approve ก่อน hold=' || v_n);
    perform analytics.content_piece_advance(v_shop, v_s2, 'resume', 'owner');
    v_log := v_log || pg_temp.b_('N5h', 'resume แล้ว can_approve กลับเป็น true', (select can_approve from analytics.v_content_piece where step_id = v_s2) is true);
  exception when others then
    v_log := v_log || format(E'[FAIL] N5 ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  -- N6: guard ที่ผูก current_user (L1) ต้องไม่ทำให้ flow จริงพัง เมื่อรันด้วย role จริงของแอป (service_role → RPC security definer → เจ้าของฟังก์ชัน)
  begin
    select s.id into v_s from analytics.campaign_step s where s.piece_status = 'approved' order by s.id limit 1;
    select a.id into v_a from analytics.step_artifact a where a.step_id = v_s order by a.id limit 1;
    set local role service_role;
    -- flow ใหม่ทั้งวงจรผ่าน RPC ด้วย service_role: create → drafting → AI ร่าง → in_review → 3 ด่าน → approved → ส่งกลับ → แก้ → hook → AI ร่างซ้ำ
    v_r := '';
    begin
      v_s2 := analytics.content_piece_create(v_shop, 'qa-0159 N6 ' || substr(gen_random_uuid()::text, 1, 6), 'short_clip', 'tiktok', 'jewelry_925', 'owner', v_today + 5);
      perform analytics.content_piece_advance(v_shop, v_s2, 'drafting', 'owner');
      select a.id into v_sig from analytics.step_artifact a where a.step_id = v_s2;
      perform analytics.campaign_ai_draft_artifact(v_sig, 'ร่างโดย AI',
        '{"segments":[{"role":"hook"}],"shots":[{"id":"s1","desc":"ถ่ายหน้าโต๊ะ"}]}'::jsonb, 'qa-model');
      perform analytics.content_hook_upsert(v_shop, v_s2, 'A', 'hook A', 'question', null, 'owner', null);
      perform analytics.content_hook_upsert(v_shop, v_s2, 'B', 'hook B', 'fact', null, 'owner', null);
      perform analytics.content_piece_advance(v_shop, v_s2, 'in_review', 'owner');
      perform pg_temp.gates_(v_shop, v_s2);
      perform analytics.content_piece_advance(v_shop, v_s2, 'approved', 'owner', null, 10);
      perform analytics.content_piece_advance(v_shop, v_s2, 'in_review', 'owner', 'ส่งกลับแก้');
      perform analytics.campaign_set_artifact_content(v_sig, 'แก้เนื้อหาหลังส่งกลับ', null);
      perform analytics.content_piece_advance(v_shop, v_s2, 'cancelled', 'owner', 'ยกเลิก');
      perform analytics.content_piece_advance(v_shop, v_s2, 'restore', 'owner', 'กู้');
      v_r := 'OK';
    exception when others then
      v_r := 'FAIL sqlstate=' || sqlstate || ' msg=' || left(sqlerrm, 200);
    end;
    -- ตั้ง GUC เองแล้วเขียนตรง (ต้องโดน guard — L1)
    perform set_config('c2.piece_rpc', '1', true);
    v_txt := pg_temp.q_ex(format('update analytics.campaign_step set piece_status = ''posted'' where id = %L::uuid', v_s), array['55000', '42501']);
    v_txt2 := pg_temp.q_ex(format('update analytics.step_artifact set content_body = ''hack'' where id = %L::uuid', v_a), array['55000', '42501']);
    v_ans := pg_temp.q_ex(format('delete from analytics.step_artifact where id = %L::uuid', v_a), array['55000', '42501']);
    v_before := pg_temp.q_ex(format('insert into analytics.step_artifact (step_id, shop_id, artifact_type, status) select step_id, shop_id, artifact_type, ''todo'' from analytics.step_artifact where id = %L::uuid', v_a), array['55000', '42501']);
    -- ช่องที่เหลือ (บันทึกเป็น NOTE ถ้าผ่าน): GUC ตั้งเองแล้วเรียก RPC เดิม (security definer = รันเป็นเจ้าของฟังก์ชัน → guard เห็น current_user เป็น postgres)
    v_after := pg_temp.q_ok(format('select analytics.campaign_set_artifact_content(%L::uuid, %L, null)', v_a, 'แก้ผ่าน RPC เดิมหลังตั้ง GUC เอง'));
    perform set_config('c2.piece_rpc', '', true);
    reset role;
    v_log := v_log || pg_temp.l_('N6a', 'service_role + ตั้ง GUC เอง: UPDATE piece_status ตรงบนชิ้นอนุมัติแล้ว ถูกปฏิเสธ', v_txt);
    v_log := v_log || pg_temp.l_('N6b', 'service_role + ตั้ง GUC เอง: UPDATE step_artifact.content_body ตรงบนชิ้นอนุมัติแล้ว ถูกปฏิเสธ', v_txt2);
    v_log := v_log || pg_temp.l_('N6c', 'service_role + ตั้ง GUC เอง: DELETE step_artifact ตรงบนชิ้นอนุมัติแล้ว ถูกปฏิเสธ', v_ans);
    v_log := v_log || pg_temp.l_('N6d', 'service_role + ตั้ง GUC เอง: INSERT step_artifact ใหม่เข้าชิ้นอนุมัติแล้ว ถูกปฏิเสธ (L4)', v_before);
    v_log := v_log || pg_temp.b_('N6e', 'flow ใหม่ทั้งวงจร (create→AI ร่าง→hook→ตรวจ→อนุมัติ→ส่งกลับ→แก้→ยกเลิก→กู้) ผ่าน RPC ด้วย role service_role สำเร็จ', v_r = 'OK', v_r);
    if v_after = 'OK' then
      v_log := v_log || pg_temp.n_('N6f', 'ช่องเหลือ (ส่งต่อ security): session ที่รัน SQL ได้ในนาม service_role ตั้ง c2.piece_rpc=1 เองแล้วเรียก RPC เดิม security definer (campaign_set_artifact_content) แก้เนื้อหาชิ้นที่อนุมัติแล้วได้ — guard เห็น current_user = เจ้าของฟังก์ชัน · ต้องมีสิทธิ์รัน SQL ดิบเป็น service_role (PostgREST ตั้ง GUC ไม่ได้) จึงไม่ใช่ช่องหน้าเว็บ · ตรงกับข้อจำกัดที่ dev เขียนไว้หัวไฟล์ข้อ P');
    else
      v_log := v_log || pg_temp.b_('N6f', 'ตั้ง GUC เองแล้วเรียก RPC เดิม ก็ยังถูกปฏิเสธ', true, v_after);
    end if;
  exception when others then
    reset role;
    v_log := v_log || format(E'[FAIL] N6 ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;
  exception when others then
    v_log := v_log || format(E'[FAIL] N ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  begin
  ----------------------------------------------------------------------------
  -- L. GUC ไม่ค้าง · เขียนตรงยังโดน guard
  ----------------------------------------------------------------------------
  v_log := v_log || pg_temp.b_('L1', 'หลัง flow ทั้งหมด GUC c2.piece_rpc ไม่ค้างเป็น 1', coalesce(current_setting('c2.piece_rpc', true), '') <> '1', coalesce(current_setting('c2.piece_rpc', true), '(null)'));
  select s.id into v_s from analytics.campaign_step s where s.piece_status = 'planned' order by s.id limit 1;
  v_log := v_log || pg_temp.l_('L2', 'UPDATE piece_status ตรง → 55000', pg_temp.q_ex(format('update analytics.campaign_step set piece_status = ''approved'' where id = %L::uuid', v_s), array['55000']));
  v_log := v_log || pg_temp.l_('L3', 'UPDATE status ตรงบนชิ้นใน workflow → 55000', pg_temp.q_ex(format('update analytics.campaign_step set status = ''done'' where id = %L::uuid', v_s), array['55000']));
  v_log := v_log || pg_temp.l_('L4', 'UPDATE step_artifact.status = approved ตรง → 55000', pg_temp.q_ex(format('update analytics.step_artifact set status = ''approved'' where step_id = %L::uuid', v_s), array['55000']));
  v_log := v_log || pg_temp.l_('L5', 'INSERT campaign_step ที่ใส่ piece_status เอง → 55000',
    pg_temp.q_ex(format('insert into analytics.campaign_step (campaign_id, shop_id, seq, step_kind, title, offset_start_days, status, origin, piece_status) select campaign_id, shop_id, 99, ''content_task'', ''x'', 0, ''todo'', ''manual'', ''approved'' from analytics.campaign_step where id = %L::uuid', v_s), array['55000']));
  -- exception ที่ถูกจับ: GUC ที่ตั้งใน subtransaction ต้องย้อนกลับ (ไม่ค้างจนข้าม guard ได้)
  begin
    begin
      perform set_config('c2.piece_rpc', '1', true);
      raise exception 'qa_boom' using errcode = 'QA002';
    exception when sqlstate 'QA002' then null;
    end;
    v_log := v_log || pg_temp.b_('L6', 'GUC ที่ตั้งใน subtransaction ที่ rollback ถูกย้อนกลับ (ไม่ค้าง = ไม่มีทางเปิดประตูหลังโดยบังเอิญ)', coalesce(current_setting('c2.piece_rpc', true), '') <> '1');
  end;
  exception when others then
    v_log := v_log || format(E'[FAIL] L ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  begin
  ----------------------------------------------------------------------------
  -- V. v_content_piece
  ----------------------------------------------------------------------------
  select string_agg(column_name, ',') into v_txt from information_schema.columns
   where table_schema = 'analytics' and table_name = 'v_content_piece' and column_name ~* '(display_name|real_name|host_name|full_name|phone|email|line_id)';
  v_log := v_log || pg_temp.b_('V1', 'v_content_piece ไม่มีคอลัมน์ชื่อจริง/ช่องติดต่อของโฮสต์ (เหลือเฉพาะ public_label)', v_txt is null, coalesce(v_txt, ''));
  select count(*) into v_n from analytics.v_content_piece
   where resolved_start is not null and days_until is distinct from (resolved_start - v_today);
  v_log := v_log || pg_temp.b_('V2', 'days_until = resolved_start − วันไทยวันนี้ ทุกแถว', v_n = 0, 'ผิด ' || v_n);
  select coalesce(sum(jsonb_array_length(p.hooks)), 0) into v_n from analytics.v_content_piece p where p.title not like 'qa-0159%';
  select count(*) into v_n2 from analytics.content_hook h where h.origin = 'ours' and h.step_id in (select step_id from analytics.v_content_piece where title not like 'qa-0159%');
  v_log := v_log || pg_temp.b_('V3', 'hooks[] รวมของ 26 ชิ้นจริง = จำนวน content_hook ours ที่ผูกชิ้นเหล่านั้น (26) — view ไม่ทำ hook หล่น/ซ้ำจาก join', v_n = v_n2 and v_n = 26, 'view=' || v_n || ' table=' || v_n2);
  v_log := v_log || pg_temp.b_('V4', 'authenticated/anon ไม่มีสิทธิ์ select v_content_piece', not has_table_privilege('authenticated', 'analytics.v_content_piece', 'select') and not has_table_privilege('anon', 'analytics.v_content_piece', 'select'));
  select count(*) into v_n from analytics.v_content_piece where can_approve and piece_status is distinct from 'in_review';
  v_log := v_log || pg_temp.b_('V5a', 'can_approve = true เฉพาะ piece_status = in_review (UI ไม่ต้องเช็คสถานะคู่อีก — แก้ตาม QA note รอบก่อน)', v_n = 0, 'แถวผิด ' || v_n);
  select count(*) into v_n from analytics.v_content_piece p
   where p.can_approve is distinct from (p.piece_status = 'in_review' and p.hold_reason is null
         and cardinality(analytics.content_piece_approve_blockers(p.step_id)) = 0);
  v_log := v_log || pg_temp.b_('V5b', 'can_approve = (in_review ∧ ไม่ hold ∧ approve_blockers ว่าง) ทุกแถว — สูตรเดียวกับ RPC อนุมัติ', v_n = 0, 'แถวผิด ' || v_n);

  exception when others then
    v_log := v_log || format(E'[FAIL] V ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  exception when others then
    v_log := v_log || format(E'[FAIL] ABORT ทั้งไฟล์ sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_note := (length(v_log) - length(replace(v_log, '[NOTE]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] %s · [FAIL] %s · [NOTE] %s — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n', v_ok, v_fail, v_note);
  raise exception '%', v_log;
end
$qa0159$;
