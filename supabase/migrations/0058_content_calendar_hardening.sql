-- 0058_content_calendar_hardening.sql
-- Fixes from the security review of 0057 (security-auditor, M1). Everything
-- here is a CREATE OR REPLACE of a function shipped in 0057 plus one new
-- column — 0057 itself is left as applied.
--
-- H1 (high) — R5 could overwrite content a human had APPROVED. Its only guard
--   was `human_edited`, but R7 (the approve path) never sets that flag: an
--   agent retry after sign-off rewrote the copy while the approver's
--   reviewed_by/at stayed on it. R5 now refuses approved/done/reviewed
--   artifacts, and clears the review stamp on any draft it does write.
-- M1 — a manual step appended to a template campaign was undeletable forever
--   (R2 allowed the append, R8 refused deletion for the whole campaign).
--   Provenance now lives on the step (`origin`), so R8 judges the step.
-- M2 — no size ceiling on clip_brief/content_body. The writer is an LLM and
--   v_campaign_board inlines every brief into one jsonb_agg, so one oversized
--   brief slows every board read. Capped at 64KB / 20 segments / 50 shots /
--   20k chars of body.
-- M3 — R6 derived the shots[] index from an unlocked read, so a concurrent R4
--   could reshuffle the array before the jsonb_set landed. Now SELECT ... FOR
--   UPDATE, and shot ids must be unique (R6 ticks by id).
-- L2/L3/L4/L5/L7 — grant symmetry on the validator; reject an explicit json
--   null desc; treat '' as "no reco key"; make a raced approval idempotent
--   instead of a 23505; and stop a no-op edit from flipping human_edited
--   (which locked the agent out for nothing).
--
-- M4 (approve records reviewed_at but reviewed_by is null, because every call
-- today comes through the service-role client where auth.uid() is null) is NOT
-- fixed here: it needs a real caller identity, which arrives with the A2 auth
-- phase. Recorded as debt rather than papered over.

alter table analytics.campaign_step
  add column if not exists origin text not null default 'template';
alter table analytics.campaign_step drop constraint if exists campaign_step_origin_check;
alter table analytics.campaign_step add constraint campaign_step_origin_check
  check (origin in ('template','manual'));

comment on column analytics.campaign_step.origin is
  'template = created by campaign_create_from_template (undeletable in phase 1) | manual = created by campaign_create_task (owner can delete). Existing rows default to template, which is what they are.';

create or replace function analytics.assert_clip_brief_valid(p_brief jsonb)
 returns void
 language plpgsql
 immutable
 set search_path to 'public', 'analytics', 'pg_temp'
as $$
declare v_seg jsonb; v_shot jsonb; v_shots jsonb;
begin
  if jsonb_typeof(p_brief) <> 'object' then
    raise exception 'clip_brief must be a json object' using errcode = '22023';
  end if;

  if pg_column_size(p_brief) > 65536 then
    raise exception 'clip_brief too large (% bytes, max 65536)', pg_column_size(p_brief)
      using errcode = '22023';
  end if;

  v_shots := coalesce(p_brief->'shots', '[]'::jsonb);
  if jsonb_array_length(coalesce(p_brief->'segments', '[]'::jsonb)) > 20
     or jsonb_array_length(v_shots) > 50 then
    raise exception 'clip_brief: max 20 segments / 50 shots' using errcode = '22023';
  end if;

  for v_seg in select * from jsonb_array_elements(coalesce(p_brief->'segments', '[]'::jsonb)) loop
    if coalesce(v_seg->>'role', '') not in ('hook','body','close') then
      raise exception 'clip_brief.segments[].role must be hook/body/close' using errcode = '22023';
    end if;
  end loop;

  for v_shot in select * from jsonb_array_elements(v_shots) loop
    -- ->> (not ->) so an explicit json null desc is rejected too
    if coalesce(v_shot->>'id', '') = '' or coalesce(v_shot->>'desc', '') = '' then
      raise exception 'clip_brief.shots[] needs a non-empty id and desc' using errcode = '22023';
    end if;
  end loop;

  -- ids must be unique: R6 ticks by id and would otherwise hit the first match
  if (select count(*) from jsonb_array_elements(v_shots) s)
     <> (select count(distinct s->>'id') from jsonb_array_elements(v_shots) s) then
    raise exception 'clip_brief.shots[].id must be unique' using errcode = '22023';
  end if;
end;
$$;

create or replace function analytics.campaign_create_from_template(
  p_shop_id uuid,
  p_template_code text,
  p_anchor_date date,
  p_reco_key text default null,
  p_name_override text default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_tpl analytics.campaign_template%rowtype;
  v_campaign_id uuid;
  v_reco_key text := nullif(btrim(p_reco_key), '');   -- '' is not a key (L4)
  v_step jsonb;
  v_step_id uuid;
  v_artifact jsonb;
  v_gate text;
begin
  if p_shop_id is null or p_template_code is null or p_anchor_date is null then
    raise exception 'campaign_create_from_template: p_shop_id, p_template_code and p_anchor_date are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  if v_reco_key is not null then
    select id into v_campaign_id from analytics.campaign
      where shop_id = p_shop_id and source_reco_key = v_reco_key;
    if v_campaign_id is not null then
      return v_campaign_id;
    end if;
  end if;

  select * into v_tpl from analytics.campaign_template
    where code = p_template_code and is_active;
  if v_tpl.code is null then
    raise exception 'campaign_create_from_template: template % not found or inactive', p_template_code;
  end if;

  begin
    insert into analytics.campaign
      (shop_id, name, campaign_type, trigger_kind, status, anchor_date, primary_channels,
       source_reco_key, created_by, updated_by)
    values
      (p_shop_id, coalesce(nullif(btrim(p_name_override), ''), v_tpl.name_th),
       v_tpl.campaign_type, v_tpl.trigger_kind, 'scheduled', p_anchor_date, v_tpl.primary_channels,
       v_reco_key, auth.uid(), auth.uid())
    returning id into v_campaign_id;
  exception when unique_violation then
    -- two approvals raced; the other one won — hand back its campaign (L5)
    select id into v_campaign_id from analytics.campaign
      where shop_id = p_shop_id and source_reco_key = v_reco_key;
    return v_campaign_id;
  end;

  for v_step in select * from jsonb_array_elements(v_tpl.steps) loop
    insert into analytics.campaign_step
      (campaign_id, shop_id, seq, step_kind, offset_start_days, offset_end_days,
       audience_segment, channel, goal_kpi, status, origin, created_by, updated_by)
    values
      (v_campaign_id, p_shop_id, (v_step->>'seq')::int, v_step->>'step_kind',
       (v_step->>'offset_start_days')::int, (v_step->>'offset_end_days')::int,
       v_step->>'audience_segment', v_step->>'channel', v_step->>'goal_kpi',
       'scheduled', 'template', auth.uid(), auth.uid())
    returning id into v_step_id;

    for v_artifact in select * from jsonb_array_elements(coalesce(v_step->'artifacts', '[]'::jsonb)) loop
      insert into analytics.step_artifact
        (step_id, shop_id, artifact_type, owner_role, status, generated_by, created_by, updated_by)
      values
        (v_step_id, p_shop_id, v_artifact->>'artifact_type', v_artifact->>'owner_role',
         'todo', 'template_seed', auth.uid(), auth.uid());
    end loop;

    for v_gate in select jsonb_array_elements_text(coalesce(v_step->'gates', '[]'::jsonb)) loop
      insert into analytics.step_gate (step_id, shop_id, gate_kind, status)
      values (v_step_id, p_shop_id, v_gate, 'pending')
      on conflict do nothing;
    end loop;
  end loop;

  return v_campaign_id;
end;
$$;

create or replace function analytics.campaign_create_task(
  p_shop_id uuid,
  p_title text,
  p_date date,
  p_artifact_type text default null,
  p_campaign_id uuid default null,
  p_step_kind text default null
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
     status, origin, created_by, updated_by)
  values
    (v_campaign_id, p_shop_id, v_seq, coalesce(p_step_kind, 'content_task'), btrim(p_title),
     v_offset, v_offset, 'scheduled', 'manual', auth.uid(), auth.uid())
  returning id into v_step_id;

  if p_artifact_type is not null then
    insert into analytics.step_artifact
      (step_id, shop_id, artifact_type, owner_role, status, created_by, updated_by)
    values (v_step_id, p_shop_id, p_artifact_type, 'owner', 'todo', auth.uid(), auth.uid());
  end if;

  return v_step_id;
end;
$$;

create or replace function analytics.campaign_set_artifact_content(
  p_artifact_id uuid,
  p_content_body text default null,
  p_clip_brief jsonb default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare v_shop_id uuid; v_status text;
begin
  if p_artifact_id is null then
    raise exception 'campaign_set_artifact_content: p_artifact_id is required';
  end if;
  -- nothing to write: don't flip human_edited and lock the agent out (L7)
  if p_content_body is null and p_clip_brief is null then
    return;
  end if;
  if p_content_body is not null and length(p_content_body) > 20000 then
    raise exception 'campaign_set_artifact_content: content_body too long (% chars, max 20000)', length(p_content_body)
      using errcode = '22023';
  end if;
  select shop_id, status into v_shop_id, v_status from analytics.step_artifact where id = p_artifact_id;
  if v_shop_id is null then
    raise exception 'campaign_set_artifact_content: artifact % not found', p_artifact_id;
  end if;
  perform analytics.crm_require_owner_admin(v_shop_id);

  if p_clip_brief is not null then
    perform analytics.assert_clip_brief_valid(p_clip_brief);
  end if;

  update analytics.step_artifact
    set content_body = coalesce(p_content_body, content_body),
        clip_brief   = coalesce(p_clip_brief, clip_brief),
        human_edited = true,
        status = case when status = 'todo' then 'draft' else status end,
        updated_by = auth.uid(), updated_at = now()
    where id = p_artifact_id;
end;
$$;

create or replace function analytics.campaign_ai_draft_artifact(
  p_artifact_id uuid,
  p_content_body text,
  p_clip_brief jsonb,
  p_model text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare v_shop_id uuid; v_human_edited boolean; v_status text; v_reviewed_at timestamptz;
begin
  if p_artifact_id is null then
    raise exception 'campaign_ai_draft_artifact: p_artifact_id is required';
  end if;
  if p_content_body is not null and length(p_content_body) > 20000 then
    raise exception 'campaign_ai_draft_artifact: content_body too long (% chars, max 20000)', length(p_content_body)
      using errcode = '22023';
  end if;
  select shop_id, human_edited, status, reviewed_at
    into v_shop_id, v_human_edited, v_status, v_reviewed_at
    from analytics.step_artifact where id = p_artifact_id;
  if v_shop_id is null then
    raise exception 'campaign_ai_draft_artifact: artifact % not found', p_artifact_id;
  end if;
  perform analytics.crm_require_owner_admin(v_shop_id);

  if v_human_edited then
    raise exception 'campaign_ai_draft_artifact: artifact % was edited by a human, refusing to overwrite', p_artifact_id
      using errcode = '22023';
  end if;
  -- H1: a human signed this off — an agent must not quietly rewrite it under
  -- their signature.
  if v_status in ('approved','done') or v_reviewed_at is not null then
    raise exception 'campaign_ai_draft_artifact: artifact % is already % (reviewed_at=%), refusing to overwrite approved content',
                    p_artifact_id, v_status, v_reviewed_at
      using errcode = '22023';
  end if;
  if p_clip_brief is not null then
    perform analytics.assert_clip_brief_valid(p_clip_brief);
  end if;

  update analytics.step_artifact
    set content_body = coalesce(p_content_body, content_body),
        clip_brief = coalesce(p_clip_brief, clip_brief),
        status = 'draft_pending_review',
        generated_by = 'ai_copywriter',
        generated_model = p_model,
        generated_at = now(),
        reviewed_by = null,
        reviewed_at = null,
        updated_at = now()
    where id = p_artifact_id;
end;
$$;

create or replace function analytics.campaign_toggle_clip_shot(
  p_artifact_id uuid,
  p_shot_id text,
  p_done boolean
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare v_shop_id uuid; v_brief jsonb; v_idx int;
begin
  if p_artifact_id is null or p_shot_id is null then
    raise exception 'campaign_toggle_clip_shot: p_artifact_id and p_shot_id are required';
  end if;
  -- M3: lock the row before deriving the index, so a concurrent content write
  -- can't reshuffle shots[] between the read and the jsonb_set.
  select shop_id, clip_brief into v_shop_id, v_brief
    from analytics.step_artifact where id = p_artifact_id
    for update;
  if v_shop_id is null then
    raise exception 'campaign_toggle_clip_shot: artifact % not found', p_artifact_id;
  end if;
  perform analytics.crm_require_owner_admin(v_shop_id);

  select ord - 1 into v_idx
  from jsonb_array_elements(coalesce(v_brief->'shots', '[]'::jsonb)) with ordinality as t(shot, ord)
  where shot->>'id' = p_shot_id
  limit 1;
  if v_idx is null then
    raise exception 'campaign_toggle_clip_shot: shot % not found in artifact %', p_shot_id, p_artifact_id
      using errcode = '22023';
  end if;

  update analytics.step_artifact
    set clip_brief = jsonb_set(clip_brief, array['shots', v_idx::text, 'done'], to_jsonb(coalesce(p_done, false))),
        updated_by = auth.uid(), updated_at = now()
    where id = p_artifact_id;
end;
$$;

create or replace function analytics.campaign_delete_step(p_step_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare v_shop_id uuid; v_campaign_id uuid; v_origin text; v_type text; v_remaining int;
begin
  if p_step_id is null then raise exception 'campaign_delete_step: p_step_id is required'; end if;
  select cs.shop_id, cs.campaign_id, cs.origin, cp.campaign_type
    into v_shop_id, v_campaign_id, v_origin, v_type
  from analytics.campaign_step cs
  join analytics.campaign cp on cp.id = cs.campaign_id
  where cs.id = p_step_id;
  if v_shop_id is null then raise exception 'campaign_delete_step: step % not found', p_step_id; end if;
  perform analytics.crm_require_owner_admin(v_shop_id);

  -- M1: judged per step, not per campaign — a task the owner added by hand to a
  -- real campaign is theirs to remove; template steps stay put.
  if v_origin <> 'manual' then
    raise exception 'campaign_delete_step: only manually-created steps can be deleted (this step came from a template plan)'
      using errcode = '22023';
  end if;

  delete from analytics.campaign_step where id = p_step_id;

  select count(*) into v_remaining from analytics.campaign_step where campaign_id = v_campaign_id;
  if v_remaining = 0 and v_type = 'content_task' then
    delete from analytics.campaign where id = v_campaign_id;
  end if;
end;
$$;

revoke execute on function analytics.assert_clip_brief_valid(jsonb) from public, anon, authenticated;
grant execute on function analytics.assert_clip_brief_valid(jsonb) to service_role;

notify pgrst, 'reload schema';
