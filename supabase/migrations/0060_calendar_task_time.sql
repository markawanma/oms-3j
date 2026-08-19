-- 0060_calendar_task_time.sql
-- Optional time-of-day on a calendar task.
--
-- Why now: the live stream doesn't start at a fixed hour — some days 18:00,
-- some days 21:00 — so "post the teaser before the live" can't be expressed by
-- a date alone. The owner wants to set the time per task by hand (before/after
-- that day's live), and a live session itself is entered as a task with a
-- start time.
--
-- Nullable on purpose: plenty of tasks ("ถ่ายคลิป") genuinely have no clock
-- time, and forcing one would be fake precision. Untimed tasks sort after
-- timed ones within a day (UI decision, not encoded here).
--
-- `time` (no zone) rather than timestamptz: this is a wall-clock intention in
-- the shop's own day ("19:00"), not an instant — storing it with a zone would
-- invite it shifting under a viewer in another offset.
--
-- Both RPCs are dropped and recreated rather than overloaded: PostgREST
-- resolves by argument name so an extra overload would work, but leaving two
-- signatures of the same function is a trap for whoever reads it next.

alter table analytics.campaign_step
  add column if not exists start_time time;

comment on column analytics.campaign_step.start_time is
  'Optional wall-clock start (Asia/Bangkok intent) for this task. NULL = no specific time.';

drop function if exists analytics.campaign_create_task(uuid, text, date, text, uuid, text);

create or replace function analytics.campaign_create_task(
  p_shop_id uuid,
  p_title text,
  p_date date,
  p_artifact_type text default null,
  p_campaign_id uuid default null,
  p_step_kind text default null,
  p_start_time time default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_campaign_id uuid := p_campaign_id;
  v_anchor date;
  v_seq int;
  v_offset int;
  v_step_id uuid;
begin
  if p_shop_id is null or p_date is null then
    raise exception 'campaign_create_task: p_shop_id and p_date are required';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'campaign_create_task: p_title is required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  if v_campaign_id is null then
    insert into analytics.campaign
      (shop_id, name, campaign_type, trigger_kind, status, anchor_date, created_by, updated_by)
    values
      (p_shop_id, btrim(p_title), 'content_task', 'manual', 'scheduled', p_date, auth.uid(), auth.uid())
    returning id into v_campaign_id;
    v_seq := 1;
    v_offset := 0;
  else
    select anchor_date into v_anchor from analytics.campaign
      where id = v_campaign_id and shop_id = p_shop_id;
    if not found then
      raise exception 'campaign_create_task: campaign % not found for this shop', v_campaign_id;
    end if;
    if v_anchor is null then
      raise exception 'campaign_create_task: campaign % has no anchor_date, cannot place a dated step', v_campaign_id;
    end if;
    select coalesce(max(seq), 0) + 1 into v_seq from analytics.campaign_step where campaign_id = v_campaign_id;
    v_offset := p_date - v_anchor;
  end if;

  insert into analytics.campaign_step
    (campaign_id, shop_id, seq, step_kind, title, offset_start_days, offset_end_days,
     status, origin, start_time, created_by, updated_by)
  values
    (v_campaign_id, p_shop_id, v_seq, coalesce(p_step_kind, 'content_task'), btrim(p_title),
     v_offset, v_offset, 'scheduled', 'manual', p_start_time, auth.uid(), auth.uid())
  returning id into v_step_id;

  if p_artifact_type is not null then
    insert into analytics.step_artifact
      (step_id, shop_id, artifact_type, owner_role, status, created_by, updated_by)
    values (v_step_id, p_shop_id, p_artifact_type, 'owner', 'todo', auth.uid(), auth.uid());
  end if;

  return v_step_id;
end;
$$;

-- p_clear_time distinguishes "leave the time alone" (null time, false) from
-- "remove the time" (null time, true) — without it a task could never go back
-- to being untimed.
drop function if exists analytics.campaign_reschedule_step(uuid, date);

create or replace function analytics.campaign_reschedule_step(
  p_step_id uuid,
  p_new_date date,
  p_new_time time default null,
  p_clear_time boolean default false
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_shop_id uuid; v_campaign_id uuid; v_anchor date; v_type text;
  v_start int; v_end int; v_delta int; v_step_count int;
begin
  if p_step_id is null or p_new_date is null then
    raise exception 'campaign_reschedule_step: p_step_id and p_new_date are required';
  end if;

  select cs.shop_id, cs.campaign_id, cs.offset_start_days, cs.offset_end_days,
         cp.anchor_date, cp.campaign_type
    into v_shop_id, v_campaign_id, v_start, v_end, v_anchor, v_type
  from analytics.campaign_step cs
  join analytics.campaign cp on cp.id = cs.campaign_id
  where cs.id = p_step_id;
  if v_shop_id is null then
    raise exception 'campaign_reschedule_step: step % not found', p_step_id;
  end if;
  perform analytics.crm_require_owner_admin(v_shop_id);
  if v_anchor is null then
    raise exception 'campaign_reschedule_step: campaign has no anchor_date';
  end if;

  select count(*) into v_step_count from analytics.campaign_step where campaign_id = v_campaign_id;

  if v_type = 'content_task' and v_step_count = 1 then
    update analytics.campaign
      set anchor_date = p_new_date, updated_by = auth.uid(), updated_at = now()
      where id = v_campaign_id;
  else
    v_delta := (p_new_date - v_anchor) - v_start;
    update analytics.campaign_step
      set offset_start_days = offset_start_days + v_delta,
          offset_end_days = case when offset_end_days is null then null else offset_end_days + v_delta end,
          updated_by = auth.uid(), updated_at = now()
      where id = p_step_id;
  end if;

  update analytics.campaign_step
    set start_time = case when p_clear_time then null
                          when p_new_time is not null then p_new_time
                          else start_time end,
        updated_by = auth.uid(), updated_at = now()
    where id = p_step_id;
end;
$$;

revoke execute on function analytics.campaign_create_task(uuid, text, date, text, uuid, text, time) from public, anon, authenticated;
grant execute on function analytics.campaign_create_task(uuid, text, date, text, uuid, text, time) to authenticated, service_role;
revoke execute on function analytics.campaign_reschedule_step(uuid, date, time, boolean) from public, anon, authenticated;
grant execute on function analytics.campaign_reschedule_step(uuid, date, time, boolean) to authenticated, service_role;

-- v_campaign_board: step_origin + start_time appended at the very end (existing
-- columns keep their name/type/order, which CREATE OR REPLACE VIEW requires).
-- start_time is formatted to "HH:MM" here so every consumer renders the same
-- string instead of each one trimming Postgres's "19:00:00".
create or replace view analytics.v_campaign_board
  with (security_invoker = true) as
select
  cs.id as step_id,
  cs.campaign_id,
  cs.shop_id,
  cp.name as campaign_name,
  cp.campaign_type,
  cp.trigger_kind,
  cp.status as campaign_status,
  cp.anchor_date,
  cp.primary_channels,
  cp.blocked_reason as campaign_blocked_reason,
  cp.note as campaign_note,
  cs.seq,
  cs.step_kind,
  cs.offset_start_days,
  cs.offset_end_days,
  case when cp.anchor_date is null then null
    else cp.anchor_date + cs.offset_start_days end as resolved_start,
  case when cp.anchor_date is null or cs.offset_end_days is null then null
    else cp.anchor_date + cs.offset_end_days end as resolved_end,
  case when cp.anchor_date is null then null
    else (cp.anchor_date + cs.offset_start_days) - current_date end as days_until,
  cs.audience_segment,
  case when cs.audience_segment in ('champion', 'loyal', 'new', 'at_risk')
    then coalesce(rfm.live_count, 0) else null end as audience_live_count,
  cs.channel,
  cs.goal_kpi,
  cs.status as step_status,
  cs.blocked_reason as step_blocked_reason,
  coalesce(art.artifacts, '[]'::jsonb) as artifacts,
  coalesce(art.art_total, 0) as art_total,
  coalesce(art.art_done, 0) as art_done,
  coalesce(gt.gates, '[]'::jsonb) as gates,
  case
    when coalesce(art.art_blocked, 0) > 0 or coalesce(gt.gate_blocked, 0) > 0 then 'blocked'
    when cs.audience_segment is not null
      and cp.trigger_kind = 'data_driven'
      and coalesce(rfm.live_count, 0) = 0 then 'waiting_data'
    when cs.audience_segment in ('silver_bar', 'tiktok_buyer', 'line_follower')
      and coalesce(rfm.live_count, 0) = 0 then 'waiting_data'
    else cs.status
  end as effective_status,
  cs.title as step_title,
  cp.source_reco_key,
  cs.origin as step_origin,
  to_char(cs.start_time, 'HH24:MI') as start_time
from analytics.campaign_step cs
join analytics.campaign cp on cp.id = cs.campaign_id
left join lateral (
  select count(*)::int as live_count
  from analytics.v_rfm_segment r
  where cs.audience_segment is not null
    and r.shop_id = cs.shop_id
    and r.segment = cs.audience_segment
) rfm on true
left join lateral (
  select
    jsonb_agg(
      jsonb_build_object(
        'id', sa.id,
        'artifact_type', sa.artifact_type,
        'owner_role', sa.owner_role,
        'source_doc', sa.source_doc,
        'status', sa.status,
        'is_dynamic', sa.is_dynamic,
        'dynamic_source', sa.dynamic_source,
        'dynamic_ref', sa.dynamic_ref,
        'discount_pct', sa.discount_pct,
        'note', sa.note,
        'content_body', sa.content_body,
        'clip_brief', sa.clip_brief,
        'generated_by', sa.generated_by,
        'generated_model', sa.generated_model,
        'human_edited', sa.human_edited,
        'reviewed_at', sa.reviewed_at
      ) order by sa.created_at
    ) as artifacts,
    count(*) as art_total,
    count(*) filter (where sa.status = 'done') as art_done,
    count(*) filter (where sa.status = 'blocked') as art_blocked
  from analytics.step_artifact sa
  where sa.step_id = cs.id
) art on true
left join lateral (
  select
    jsonb_agg(
      jsonb_build_object(
        'gate_kind', sg.gate_kind,
        'status', sg.status,
        'passed_by', sg.passed_by,
        'passed_at', sg.passed_at,
        'note', sg.note
      ) order by sg.gate_kind
    ) as gates,
    count(*) filter (where sg.status = 'blocked') as gate_blocked
  from analytics.step_gate sg
  where sg.step_id = cs.id
) gt on true;

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
