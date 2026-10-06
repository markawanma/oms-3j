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
