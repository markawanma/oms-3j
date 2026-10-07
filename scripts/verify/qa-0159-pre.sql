-- scripts/verify/qa-0159-pre.sql  (QA R2-D2, 7 ต.ค. 69) — baseline "ก่อน 0159" สำหรับ differential test
--
-- ต้องรันเป็นส่วนหัวของไฟล์เดียวกับ migration + qa-0159-extra.sql ใน dry-run เดียว (temp table อยู่ได้แค่ในทรานแซกชันนี้):
--   cat scripts/verify/qa-0159-pre.sql supabase/migrations/0159_content_piece_workflow.sql scripts/verify/qa-0159-extra.sql > tmp.sql
--   node scripts/run-sql.mjs tmp.sql          (ไม่ใส่ --commit — exit 1 คือผลที่คาด: extra raise บังคับ rollback)
-- ไฟล์นี้ไม่เขียนอะไรถาวร: ทุก probe ยิงใน subtransaction แล้ว raise QA001 เพื่อ rollback เสมอ (แถวจริงไม่ขยับ)
--
-- ทำอะไร: ยิง RPC เดิมทุกตัวที่แอปเรียก (พารามิเตอร์ชุดเดียวกับ lib/actions/marketing.ts + calendar.ts) ใส่ "ทุก artifact/step จริง"
-- แล้วเก็บผล (OK หรือ sqlstate:ข้อความ) ไว้เทียบกับผลหลัง migration — ผลต้องเหมือนเดิมทุกแถวสำหรับ step ที่ piece_status ยัง null

create temp table qa_probe (phase text, op text, sid uuid, aid uuid, arg text, outcome text);

create temp table qa_pre_board as
  select b.step_id, to_jsonb(b)::text as t from analytics.v_campaign_board b;
create temp table qa_pre_cols as
  select string_agg(column_name || ':' || data_type, ',' order by ordinal_position) as c
    from information_schema.columns where table_schema = 'analytics' and table_name = 'v_campaign_board';
create temp table qa_pre_misc as
  select
    (select md5(coalesce(string_agg(q::text, E'\n' order by q::text), '')) from analytics.v_content_entry_queue q) as queue_md5,
    (select md5(coalesce(string_agg(t::text, E'\n' order by t::text), '')) from analytics.v_content_post_t7 t) as t7_md5,
    (select md5(coalesce(string_agg(c::text, E'\n' order by c::text), '')) from analytics.v_campaign_calendar c) as cal_md5,
    (select count(*) from analytics.campaign) as n_campaign,
    (select count(*) from analytics.campaign_step) as n_step,
    (select count(*) from analytics.step_artifact) as n_art,
    (select count(*) from analytics.step_gate) as n_gate,
    (select count(*) from analytics.content_post) as n_post,
    (select md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), ';' order by id), '')) from analytics.campaign_step) as step_md5,
    (select md5(coalesce(string_agg(concat_ws('|', id, status, content_body, clip_brief::text, updated_at), ';' order by id), '')) from analytics.step_artifact) as art_md5;

-- ยิง SQL แล้ว rollback เสมอ · คืน 'OK' หรือ 'sqlstate:ข้อความ (uuid ถูกแทนด้วย <uuid>)'
create or replace function pg_temp.qa_try(p_sql text) returns text
 language plpgsql as $q$
begin
  execute p_sql;
  raise exception 'qa_rollback' using errcode = 'QA001';
exception when others then
  if sqlstate = 'QA001' then return 'OK'; end if;
  return sqlstate || ':' || regexp_replace(left(sqlerrm, 200),
           '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'g');
end $q$;

create or replace function pg_temp.qa_probe_all(p_phase text) returns void
 language plpgsql as $f$
declare
  r      record;
  g      record;
  v_shop uuid;
  v_ct   text;
  st     text;
  v_shot text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select id into v_shop from public.shop limit 1;
  select code into v_ct from analytics.content_type where is_active order by code limit 1;

  -- ต่อ artifact: ทุก status ที่ UI ส่งได้ (ARTIFACT_STATUSES) + แก้เนื้อหา + AI ร่าง + ติ๊ก shot
  for r in select a.id as aid, a.step_id as sid, a.clip_brief from analytics.step_artifact a order by a.id loop
    foreach st in array array['todo', 'draft_pending_review', 'draft', 'approved', 'done', 'blocked'] loop
      insert into qa_probe values (p_phase, 'set_status', r.sid, r.aid, st,
        pg_temp.qa_try(format('select analytics.campaign_set_artifact_status(%L::uuid, %L)', r.aid, st)));
    end loop;
    insert into qa_probe values (p_phase, 'set_content_body', r.sid, r.aid, 'new body',
      pg_temp.qa_try(format('select analytics.campaign_set_artifact_content(%L::uuid, %L, null)', r.aid, 'qa edit body ไทย 😀')));
    if r.clip_brief is not null then
      insert into qa_probe values (p_phase, 'set_content_brief_same', r.sid, r.aid, 'same brief',
        pg_temp.qa_try(format('select analytics.campaign_set_artifact_content(%L::uuid, null, %L::jsonb)', r.aid, r.clip_brief::text)));
    end if;
    insert into qa_probe values (p_phase, 'ai_draft', r.sid, r.aid, 'body+same brief',
      pg_temp.qa_try(format('select analytics.campaign_ai_draft_artifact(%L::uuid, %L, %L::jsonb, %L)',
                            r.aid, 'qa ai body', r.clip_brief::text, 'qa-model')));
    if jsonb_typeof(r.clip_brief -> 'shots') = 'array' and jsonb_array_length(r.clip_brief -> 'shots') > 0 then
      v_shot := r.clip_brief -> 'shots' -> 0 ->> 'id';
      if v_shot is not null then
        insert into qa_probe values (p_phase, 'toggle_shot', r.sid, r.aid, v_shot,
          pg_temp.qa_try(format('select analytics.campaign_toggle_clip_shot(%L::uuid, %L, true)', r.aid, v_shot)));
      end if;
    end if;
  end loop;

  -- ต่อ step: เลื่อนวัน (+1 วัน/ล้างเวลา และ +0 วัน/ตั้งเวลา) · ลบ · ประเภท content · ผ่าน gate เดิมทุกตัวที่มี
  for r in
    select s.id as sid, s.shop_id, (c.anchor_date + s.offset_start_days) as d
      from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id order by s.id
  loop
    if r.d is not null then
      insert into qa_probe values (p_phase, 'reschedule', r.sid, null, '+1d clear time',
        pg_temp.qa_try(format('select analytics.campaign_reschedule_step(%L::uuid, %L::date, null, true)', r.sid, r.d + 1)));
      insert into qa_probe values (p_phase, 'reschedule', r.sid, null, '+0d 19:00',
        pg_temp.qa_try(format('select analytics.campaign_reschedule_step(%L::uuid, %L::date, %L::time, false)', r.sid, r.d, '19:00')));
    end if;
    insert into qa_probe values (p_phase, 'delete_step', r.sid, null, '',
      pg_temp.qa_try(format('select analytics.campaign_delete_step(%L::uuid)', r.sid)));
    if v_ct is not null then
      insert into qa_probe values (p_phase, 'set_content_type', r.sid, null, v_ct,
        pg_temp.qa_try(format('select analytics.campaign_step_set_content_type(%L::uuid, %L::uuid, %L)', r.shop_id, r.sid, v_ct)));
    end if;
    for g in select gate_kind from analytics.step_gate where step_id = r.sid and gate_kind in
      ('cfo_discount_approval', 'coo_stock_check', 'pdpa_consent', 'quota_check', 'price_realtime_fill') loop
      insert into qa_probe values (p_phase, 'pass_gate', r.sid, null, g.gate_kind,
        pg_temp.qa_try(format('select analytics.campaign_pass_gate(%L::uuid, %L)', r.sid, g.gate_kind)));
    end loop;
  end loop;

  -- สร้างงาน/แผน: พารามิเตอร์รูปเดียวกับ createManualTask / createTaskFromReco ของแอป
  insert into qa_probe values (p_phase, 'create_task', null, null, 'basic',
    pg_temp.qa_try(format('select analytics.campaign_create_task(%L::uuid, %L, %L::date, null, null, null, null)', v_shop, 'qa task', '2026-11-20')));
  insert into qa_probe values (p_phase, 'create_task', null, null, 'clip+time',
    pg_temp.qa_try(format('select analytics.campaign_create_task(%L::uuid, %L, %L::date, %L, null, %L, %L::time)',
                          v_shop, 'qa task 😀 ไทย', '2026-11-21', 'short_form_clip', 'content_task', '19:00')));
  insert into qa_probe values (p_phase, 'create_task', null, null, 'oct-date fb_post',
    pg_temp.qa_try(format('select analytics.campaign_create_task(%L::uuid, %L, %L::date, %L, null, null, null)', v_shop, 'qa oct', '2026-10-20', 'fb_post')));
  insert into qa_probe values (p_phase, 'create_task', null, null, 'bad artifact type',
    pg_temp.qa_try(format('select analytics.campaign_create_task(%L::uuid, %L, %L::date, %L, null, null, null)', v_shop, 'qa bad', '2026-11-22', 'banana')));
  for r in select id as cid, anchor_date from analytics.campaign order by id loop
    insert into qa_probe values (p_phase, 'create_task_in_campaign', null, null, r.cid::text,
      pg_temp.qa_try(format('select analytics.campaign_create_task(%L::uuid, %L, %L::date, %L, %L::uuid, null, null)',
                            v_shop, 'qa in campaign', coalesce(r.anchor_date, date '2026-11-23'), 'fb_post', r.cid)));
  end loop;
  for r in select code from analytics.campaign_template order by code loop
    insert into qa_probe values (p_phase, 'create_from_template', null, null, r.code,
      pg_temp.qa_try(format('select analytics.campaign_create_from_template(%L::uuid, %L, %L::date, null, null)', v_shop, r.code, '2026-11-24')));
  end loop;
end $f$;

select pg_temp.qa_probe_all('pre');

-- ============================================================================
-- life (รอบ 2 · 7 ต.ค. 69): วงจรเต็มของ "step ที่สร้างใหม่หลัง migration" ด้วยพารามิเตอร์ชุดเดียวกับแอปจริง และ role จริง
--   สร้าง (campaign_create_task / campaign_create_from_template) → AI ร่างซ้ำ → เปลี่ยนสถานะ artifact ทุกค่า → แก้เนื้อหา →
--   AI ร่างหลังคนแก้ → แก้ brief → ติ๊ก shot → ประเภท content → ผ่าน gate → เลื่อน → ลบ — ทุก op อยู่ใน subtransaction เดียวต่อ step แล้ว rollback
--   รันภายใต้ `set local role service_role` (ชั้นเดียวกับ getServiceClient ของแอป — เดิม probe ทั้งหมดรันเป็น postgres ซึ่งไม่ทดสอบเงื่อนไข current_user ของ L1)
--   เก็บผลเป็นสตริงต่อ (โหมด x วัน): ผลของทุก op + piece_status ของ step ใหม่ — ต้องเท่ากันก่อน/หลัง และ piece_status ต้อง null ทั้งหมด
-- ============================================================================
create or replace function pg_temp.qa_life(p_mode text, p_date date, p_arg text) returns text
 language plpgsql as $f$
declare
  v_shop uuid; v_ct text; v_step uuid; v_camp uuid; v_d date;
  v_ops text := ''; v_ps text := '';
  s record; a record; g record;
  v_sqls text[]; v_labels text[]; v_i int; v_res text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select id into v_shop from public.shop limit 1;
  select code into v_ct from analytics.content_type where is_active order by code limit 1;
  set local role service_role;
  begin
    if p_mode = 'task' then
      v_step := analytics.campaign_create_task(v_shop, 'qa life ไทย 😀', p_date, 'fb_post', null, null, null);
    elsif p_mode = 'clip' then
      v_step := analytics.campaign_create_task(v_shop, 'qa life clip', p_date, 'short_form_clip', null, 'content_task', '19:00'::time);
    else
      v_camp := analytics.campaign_create_from_template(v_shop, p_arg, p_date, null, null);
    end if;
    v_ops := 'create=OK;';
  exception when others then
    v_ops := 'create=' || sqlstate || ';';
  end;

  for s in select st.id, st.seq from analytics.campaign_step st
            where st.id = v_step or (v_camp is not null and st.campaign_id = v_camp) order by st.seq, st.id loop
    v_ps := v_ps || coalesce((select to_jsonb(x) ->> 'piece_status' from analytics.campaign_step x where x.id = s.id), '-') || ',';
    v_ops := v_ops || 'S' || s.seq || '{';
    for a in select id from analytics.step_artifact where step_id = s.id order by id loop
      v_labels := array['ai1', 'ai2', 'st_dpr', 'st_draft', 'st_appr', 'st_done', 'st_blk', 'st_todo', 'set_body', 'ai3_after_human', 'set_brief', 'toggle', 'st_appr2'];
      v_sqls := array[
        format('select analytics.campaign_ai_draft_artifact(%L::uuid, %L, null, %L)', a.id, 'qa ai 1 ไทย', 'qa-model'),
        format('select analytics.campaign_ai_draft_artifact(%L::uuid, %L, null, %L)', a.id, 'qa ai 2 ร่างซ้ำ', 'qa-model'),
        format('select analytics.campaign_set_artifact_status(%L::uuid, %L)', a.id, 'draft_pending_review'),
        format('select analytics.campaign_set_artifact_status(%L::uuid, %L)', a.id, 'draft'),
        format('select analytics.campaign_set_artifact_status(%L::uuid, %L)', a.id, 'approved'),
        format('select analytics.campaign_set_artifact_status(%L::uuid, %L)', a.id, 'done'),
        format('select analytics.campaign_set_artifact_status(%L::uuid, %L)', a.id, 'blocked'),
        format('select analytics.campaign_set_artifact_status(%L::uuid, %L)', a.id, 'todo'),
        format('select analytics.campaign_set_artifact_content(%L::uuid, %L, null)', a.id, 'qa human body 😀 ไทย'),
        format('select analytics.campaign_ai_draft_artifact(%L::uuid, %L, null, %L)', a.id, 'qa ai 3', 'qa-model'),
        format('select analytics.campaign_set_artifact_content(%L::uuid, null, %L::jsonb)', a.id,
               '{"segments":[{"role":"hook"}],"shots":[{"id":"s1","desc":"qa shot"}]}'),
        format('select analytics.campaign_toggle_clip_shot(%L::uuid, %L, true)', a.id, 's1'),
        format('select analytics.campaign_set_artifact_status(%L::uuid, %L)', a.id, 'approved')];
      v_ops := v_ops || 'A(';
      for v_i in 1 .. array_length(v_sqls, 1) loop
        begin
          execute v_sqls[v_i];
          v_res := 'OK';
        exception when others then
          v_res := sqlstate || ':' || regexp_replace(left(sqlerrm, 120),
                   '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'g');
        end;
        v_ops := v_ops || v_labels[v_i] || '=' || v_res || ';';
      end loop;
      v_ops := v_ops || ')';
    end loop;
    -- ระดับ step
    begin
      perform analytics.campaign_step_set_content_type(v_shop, s.id, v_ct);
      v_res := 'OK';
    exception when others then
      v_res := sqlstate || ':' || left(sqlerrm, 80);
    end;
    v_ops := v_ops || 'ctype=' || v_res || ';';
    for g in select gate_kind from analytics.step_gate where step_id = s.id and gate_kind not in ('fact_check', 'brand_rule', 'risk_owner') order by gate_kind loop
      begin
        perform analytics.campaign_pass_gate(s.id, g.gate_kind);
        v_res := 'OK';
      exception when others then
        v_res := sqlstate || ':' || left(sqlerrm, 80);
      end;
      v_ops := v_ops || 'gate_' || g.gate_kind || '=' || v_res || ';';
    end loop;
    select c.anchor_date + st.offset_start_days into v_d from analytics.campaign_step st join analytics.campaign c on c.id = st.campaign_id where st.id = s.id;
    if v_d is not null then
      begin
        perform analytics.campaign_reschedule_step(s.id, v_d + 1, null, true);
        v_res := 'OK';
      exception when others then
        v_res := sqlstate || ':' || left(sqlerrm, 80);
      end;
      v_ops := v_ops || 'resched1=' || v_res || ';';
      begin
        perform analytics.campaign_reschedule_step(s.id, v_d, '19:00'::time, false);
        v_res := 'OK';
      exception when others then
        v_res := sqlstate || ':' || left(sqlerrm, 80);
      end;
      v_ops := v_ops || 'resched2=' || v_res || ';';
    end if;
    begin
      perform analytics.campaign_delete_step(s.id);
      v_res := 'OK';
    exception when others then
      v_res := sqlstate || ':' || left(sqlerrm, 80);
    end;
    v_ops := v_ops || 'delete=' || v_res || ';}';
  end loop;
  raise exception using errcode = 'QA002', message = v_ops || '|ps=' || v_ps;
end $f$;

create or replace function pg_temp.qa_life_all(p_phase text) returns void
 language plpgsql as $f$
declare
  r record; v text;
begin
  for r in
    select 'task@' || d as label, 'task' as mode, d::date as dt, null::text as arg from unnest(array['2026-09-20', '2026-10-20', '2026-11-20']) d
    union all
    select 'clip@' || d, 'clip', d::date, null from unnest(array['2026-09-21', '2026-10-21']) d
    union all
    select 'tpl:' || c.code || '@' || d, 'tpl', d::date, c.code
      from analytics.campaign_template c cross join unnest(array['2026-09-25', '2026-10-25']) d
    order by 1
  loop
    begin
      perform pg_temp.qa_life(r.mode, r.dt, r.arg);
      v := 'ไม่ raise (ผิดปกติ)';
    exception when sqlstate 'QA002' then
      v := sqlerrm;
    when others then
      v := 'ERR ' || sqlstate || ' ' || left(sqlerrm, 100);
    end;
    insert into qa_probe values (p_phase, 'life', null, null, r.label, v);
  end loop;
end $f$;

select pg_temp.qa_life_all('pre');
