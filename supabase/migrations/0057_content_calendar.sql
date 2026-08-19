-- 0057_content_calendar.sql
-- M1 of the Content Calendar phase — see
-- docs/3j-jewelry/marketing/phase-content-calendar-design.md (architect, §2/§3).
--
-- What this adds, all additive on top of 0049/0053:
--   1. widened CHECKs so a campaign can be a one-off "content_task" (manual
--      trigger) and an artifact can sit in the AI-draft states
--   2. provenance + clip-brief columns on step_artifact (who/what drafted it,
--      whether a human has since edited it, and the structured shooting brief)
--   3. analytics.campaign_template — reference data mapping an Ad Copilot reco
--      rule_code to a ready-made set of steps/artifacts/gates, seeded with the
--      two templates phase 1 needs. Adding a third later = INSERT one row, no
--      code change (same reasoning as campaign_calendar in 0034).
--   4. RPCs R1-R8 (design §3): the only write path — every one is
--      security definer + crm_require_owner_admin, mirroring 0049.
--   5. v_campaign_board re-created with step.title, campaign.source_reco_key
--      and the new artifact fields. Existing columns keep their name/type/order
--      (required for CREATE OR REPLACE VIEW, and 0049's grants carry over).
--
-- Applied to the live DB in three parts (0057a ddl / 0057b rpcs / 0057c view)
-- because of tooling payload limits; the content is exactly this file.
--
-- Constraint names below were read off pg_constraint on the live DB, not
-- guessed (design flagged this as a footgun).

-- ============================================================================
-- 1. Widen existing CHECKs (no data migration — every current row still passes)
-- ============================================================================

alter table analytics.campaign drop constraint if exists campaign_campaign_type_check;
alter table analytics.campaign add constraint campaign_campaign_type_check
  check (campaign_type in ('promo_event','winback','second_purchase_nurture','live_promo',
                           'vip_loyalty','acquisition','content_task'));

alter table analytics.campaign drop constraint if exists campaign_trigger_kind_check;
alter table analytics.campaign add constraint campaign_trigger_kind_check
  check (trigger_kind in ('calendar','data_driven','recurring','always_on','manual'));

-- 'content_task' as a step_kind: a standalone task ("ถ่ายคลิป NFC") has no
-- campaign-lifecycle meaning, and step_kind is NOT NULL. The UI shows
-- campaign_step.title for these, falling back to STEP_KIND_LABEL only when a
-- title was never set.
alter table analytics.campaign_step drop constraint if exists campaign_step_step_kind_check;
alter table analytics.campaign_step add constraint campaign_step_step_kind_check
  check (step_kind in ('teaser','vip_private_access','main_day','last_call','post_sale',
                       'reconnect','segment_offer','followup_nudge','pre_live_hook',
                       'live_session','live_highlight_recap','identify','personal_outreach',
                       'perk_fulfillment','remind','cross_sell_matching','insert_card',
                       'live_cta','capture_consent','close','content_task'));

-- status gains the two AI-draft states. 'draft_pending_review' = an agent wrote
-- it and nobody has looked yet; 'approved' = a human signed off (reviewed_by/at
-- get stamped). The original four values stay exactly as they were.
alter table analytics.step_artifact drop constraint if exists step_artifact_status_check;
alter table analytics.step_artifact add constraint step_artifact_status_check
  check (status in ('todo','draft_pending_review','draft','approved','done','blocked'));

-- ============================================================================
-- 2. New columns
-- ============================================================================

alter table analytics.campaign
  add column if not exists source_reco_key text;

comment on column analytics.campaign.source_reco_key is
  'Ad Copilot reco_key that spawned this campaign — also the idempotency key for campaign_create_from_template (approve twice = same campaign).';

create unique index if not exists uq_campaign_shop_reco
  on analytics.campaign (shop_id, source_reco_key) where source_reco_key is not null;
create index if not exists idx_campaign_shop_anchor
  on analytics.campaign (shop_id, anchor_date);

alter table analytics.campaign_step
  add column if not exists title text;

alter table analytics.step_artifact
  add column if not exists clip_brief jsonb,
  add column if not exists generated_by text not null default 'human',
  add column if not exists generated_model text,
  add column if not exists generated_at timestamptz,
  add column if not exists human_edited boolean not null default false,
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table analytics.step_artifact drop constraint if exists step_artifact_generated_by_check;
alter table analytics.step_artifact add constraint step_artifact_generated_by_check
  check (generated_by in ('human','ai_copywriter','template_seed'));

-- Shape-level only; the deep rules (segment roles, shot ids) are enforced in
-- the RPCs, which are the only writers.
alter table analytics.step_artifact drop constraint if exists step_artifact_clip_brief_shape_check;
alter table analytics.step_artifact add constraint step_artifact_clip_brief_shape_check
  check (clip_brief is null or (
    jsonb_typeof(clip_brief) = 'object'
    and coalesce(jsonb_typeof(clip_brief->'segments'), 'array') = 'array'
    and coalesce(jsonb_typeof(clip_brief->'shots'), 'array') = 'array'));

-- ============================================================================
-- 3. analytics.campaign_template — global reference data (no shop_id), same
--    pattern as campaign_calendar (0034): readable by the app, writable only
--    by migrations / service role.
-- ============================================================================

create table if not exists analytics.campaign_template (
  code             text primary key,
  name_th          text not null,
  campaign_type    text not null,
  trigger_kind     text not null,
  primary_channels text[],
  rule_code        text unique,
  anchor_semantics text not null check (anchor_semantics in ('event_date','start_date')),
  steps            jsonb not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table analytics.campaign_template is
  'Reference: an Ad Copilot reco rule_code -> the steps/artifacts/gates to create when the owner approves it. Adding a template is data, not code.';

alter table analytics.campaign_template enable row level security;

drop policy if exists read_all on analytics.campaign_template;
create policy read_all on analytics.campaign_template
  for select to authenticated, service_role using (true);

insert into analytics.campaign_template
  (code, name_th, campaign_type, trigger_kind, primary_channels, rule_code, anchor_semantics, steps)
values
  ('promo_event_5step', 'แคมเปญเทศกาล (5 ขั้น)', 'promo_event', 'calendar',
   array['line_oa','tiktok_live'], 'seasonal_calendar', 'event_date',
   $steps$[
     {"seq":1,"step_kind":"teaser","offset_start_days":-7,"offset_end_days":-4,
      "audience_segment":"all_followers","channel":"line_oa",
      "goal_kpi":"teaser click >= 15-20% = ขนาด audience วันจริง",
      "artifacts":[{"artifact_type":"broadcast_script_line","owner_role":"copywriter"},
                   {"artifact_type":"teaser_image","owner_role":"content_repurposer"},
                   {"artifact_type":"cta_button_flex","owner_role":"owner"}],
      "gates":["pdpa_consent"]},
     {"seq":2,"step_kind":"vip_private_access","offset_start_days":-3,"offset_end_days":-1,
      "audience_segment":"champion","channel":"line_oa",
      "goal_kpi":"champion -> order, AOV สูงกว่าค่าเฉลี่ย",
      "artifacts":[{"artifact_type":"dm_script_1to1","owner_role":"copywriter"},
                   {"artifact_type":"broadcast_script_line","owner_role":"copywriter"}],
      "gates":[]},
     {"seq":3,"step_kind":"main_day","offset_start_days":0,"offset_end_days":0,
      "channel":"tiktok_live","goal_kpi":"ยอดวันจริง + จำนวนคนเข้าไลฟ์",
      "artifacts":[{"artifact_type":"broadcast_script_line","owner_role":"copywriter"},
                   {"artifact_type":"live_rundown","owner_role":"host"},
                   {"artifact_type":"attribution_code","owner_role":"tech_lead"},
                   {"artifact_type":"bundle_offer_spec","owner_role":"cfo"}],
      "gates":["cfo_discount_approval","coo_stock_check"]},
     {"seq":4,"step_kind":"last_call","offset_start_days":1,"offset_end_days":1,
      "channel":"line_oa","goal_kpi":"ปิดยอดคนที่คลิกแล้วยังไม่ซื้อ",
      "artifacts":[{"artifact_type":"broadcast_script_line","owner_role":"copywriter"}],
      "gates":[]},
     {"seq":5,"step_kind":"post_sale","offset_start_days":2,"offset_end_days":5,
      "channel":"line_oa","goal_kpi":"ซื้อซ้ำ/รีวิว หลังแคมเปญ",
      "artifacts":[{"artifact_type":"broadcast_script_line","owner_role":"copywriter"},
                   {"artifact_type":"fb_post","owner_role":"copywriter"}],
      "gates":[]}
   ]$steps$::jsonb),
  ('winback_3step', 'ดึงลูกค้าเงียบกลับมา (3 ขั้น)', 'winback', 'data_driven',
   array['line_oa'], 'winback_at_risk', 'start_date',
   $steps$[
     {"seq":1,"step_kind":"reconnect","offset_start_days":0,"offset_end_days":0,
      "audience_segment":"at_risk","channel":"line_oa",
      "goal_kpi":"เปิดอ่าน/ตอบกลับ จากกลุ่มเงียบ >90 วัน",
      "artifacts":[{"artifact_type":"broadcast_script_line","owner_role":"copywriter"}],
      "gates":[]},
     {"seq":2,"step_kind":"segment_offer","offset_start_days":3,"offset_end_days":3,
      "audience_segment":"at_risk","channel":"line_oa",
      "goal_kpi":"order จากกลุ่ม at_risk",
      "artifacts":[{"artifact_type":"broadcast_script_line","owner_role":"copywriter"}],
      "gates":["cfo_discount_approval"]},
     {"seq":3,"step_kind":"followup_nudge","offset_start_days":7,"offset_end_days":7,
      "audience_segment":"at_risk","channel":"line_oa",
      "goal_kpi":"ปิดยอดกลุ่มที่ยังไม่ตอบ",
      "artifacts":[{"artifact_type":"broadcast_script_line","owner_role":"copywriter"}],
      "gates":[]}
   ]$steps$::jsonb)
on conflict (code) do update set
  name_th = excluded.name_th, campaign_type = excluded.campaign_type,
  trigger_kind = excluded.trigger_kind, primary_channels = excluded.primary_channels,
  rule_code = excluded.rule_code, anchor_semantics = excluded.anchor_semantics,
  steps = excluded.steps, updated_at = now();

-- ============================================================================
-- 4. Write RPCs (design §3). Every one: security definer, pinned search_path,
--    crm_require_owner_admin as the first thing after resolving shop_id, and
--    the same revoke/grant pair 0049 uses.
-- ============================================================================

-- R1 — approve a reco (or pick a template by hand) and materialise the whole
-- plan in one transaction. Idempotent on (shop_id, source_reco_key): approving
-- twice, or a retried request, returns the campaign that already exists rather
-- than duplicating a five-step plan.
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
  v_step jsonb;
  v_step_id uuid;
  v_artifact jsonb;
  v_gate text;
begin
  if p_shop_id is null or p_template_code is null or p_anchor_date is null then
    raise exception 'campaign_create_from_template: p_shop_id, p_template_code and p_anchor_date are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_reco_key is not null then
    select id into v_campaign_id from analytics.campaign
      where shop_id = p_shop_id and source_reco_key = p_reco_key;
    if v_campaign_id is not null then
      return v_campaign_id;   -- already approved; hand back the same plan
    end if;
  end if;

  select * into v_tpl from analytics.campaign_template
    where code = p_template_code and is_active;
  if v_tpl.code is null then
    raise exception 'campaign_create_from_template: template % not found or inactive', p_template_code;
  end if;

  insert into analytics.campaign
    (shop_id, name, campaign_type, trigger_kind, status, anchor_date, primary_channels,
     source_reco_key, created_by, updated_by)
  values
    (p_shop_id, coalesce(nullif(btrim(p_name_override), ''), v_tpl.name_th),
     v_tpl.campaign_type, v_tpl.trigger_kind, 'scheduled', p_anchor_date, v_tpl.primary_channels,
     p_reco_key, auth.uid(), auth.uid())
  returning id into v_campaign_id;

  for v_step in select * from jsonb_array_elements(v_tpl.steps) loop
    insert into analytics.campaign_step
      (campaign_id, shop_id, seq, step_kind, offset_start_days, offset_end_days,
       audience_segment, channel, goal_kpi, status, created_by, updated_by)
    values
      (v_campaign_id, p_shop_id, (v_step->>'seq')::int, v_step->>'step_kind',
       (v_step->>'offset_start_days')::int, (v_step->>'offset_end_days')::int,
       v_step->>'audience_segment', v_step->>'channel', v_step->>'goal_kpi',
       'scheduled', auth.uid(), auth.uid())
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

-- R2 — "เพิ่มแผนเอง". With no p_campaign_id this wraps the task in its own
-- thin campaign (content_task/manual) so the calendar only ever has one kind
-- of entry to render; with one, it appends a step to that campaign and derives
-- the offset from its anchor.
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
     status, created_by, updated_by)
  values
    (v_campaign_id, p_shop_id, v_seq, coalesce(p_step_kind, 'content_task'), btrim(p_title),
     v_offset, v_offset, 'scheduled', auth.uid(), auth.uid())
  returning id into v_step_id;

  if p_artifact_type is not null then
    insert into analytics.step_artifact
      (step_id, shop_id, artifact_type, owner_role, status, created_by, updated_by)
    values (v_step_id, p_shop_id, p_artifact_type, 'owner', 'todo', auth.uid(), auth.uid());
  end if;

  return v_step_id;
end;
$$;

-- R3 — move ONE step. For a one-step content_task the anchor itself moves (the
-- task simply happens on another day); inside a real campaign only that step's
-- offsets shift, so rescheduling the teaser never drags the main day with it.
create or replace function analytics.campaign_reschedule_step(
  p_step_id uuid,
  p_new_date date
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
end;
$$;

-- R4 — a human writing/editing content. Passing null for a field leaves it
-- alone (so saving just the brief never wipes the script). Marks human_edited,
-- which is what stops a later AI draft from overwriting the owner's words.
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
        -- an untouched artifact becomes a draft once someone writes in it;
        -- anything further along (approved/done/blocked) is left to the
        -- explicit status action, never moved implicitly by an edit.
        status = case when status = 'todo' then 'draft' else status end,
        updated_by = auth.uid(), updated_at = now()
    where id = p_artifact_id;
end;
$$;

-- Shared validator for the clip_brief contract (design §5). Kept as its own
-- function so R4 and R5 cannot drift apart.
create or replace function analytics.assert_clip_brief_valid(p_brief jsonb)
 returns void
 language plpgsql
 immutable
 set search_path to 'public', 'analytics', 'pg_temp'
as $$
declare v_seg jsonb; v_shot jsonb;
begin
  if jsonb_typeof(p_brief) <> 'object' then
    raise exception 'clip_brief must be a json object' using errcode = '22023';
  end if;
  for v_seg in select * from jsonb_array_elements(coalesce(p_brief->'segments', '[]'::jsonb)) loop
    if coalesce(v_seg->>'role', '') not in ('hook','body','close') then
      raise exception 'clip_brief.segments[].role must be hook/body/close' using errcode = '22023';
    end if;
  end loop;
  for v_shot in select * from jsonb_array_elements(coalesce(p_brief->'shots', '[]'::jsonb)) loop
    if coalesce(v_shot->>'id', '') = '' or v_shot->'desc' is null then
      raise exception 'clip_brief.shots[] needs a non-empty id and a desc' using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- R5 — the copywriter agent's landing pad (used fully next phase). Refuses to
-- touch anything a human has already edited: the owner's words always win.
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
declare v_shop_id uuid; v_human_edited boolean;
begin
  if p_artifact_id is null then
    raise exception 'campaign_ai_draft_artifact: p_artifact_id is required';
  end if;
  select shop_id, human_edited into v_shop_id, v_human_edited
    from analytics.step_artifact where id = p_artifact_id;
  if v_shop_id is null then
    raise exception 'campaign_ai_draft_artifact: artifact % not found', p_artifact_id;
  end if;
  perform analytics.crm_require_owner_admin(v_shop_id);

  if v_human_edited then
    raise exception 'campaign_ai_draft_artifact: artifact % was edited by a human, refusing to overwrite', p_artifact_id
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
        updated_at = now()
    where id = p_artifact_id;
end;
$$;

-- R6 — tick one shot. Writes only that element via jsonb_set so two quick taps
-- (or two devices) can't clobber each other's ticks the way a whole-blob write
-- would.
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
  select shop_id, clip_brief into v_shop_id, v_brief
    from analytics.step_artifact where id = p_artifact_id;
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

-- R7 — replaces 0049's version: same signature and same silver_bar guard (the
-- 9.9 board calls this), plus the two new states. 'approved' stamps the
-- reviewer so "AI drafted, human signed off" is visible afterwards.
create or replace function analytics.campaign_set_artifact_status(
  p_artifact_id uuid,
  p_status text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare v_shop_id uuid; v_step_id uuid; v_discount_pct numeric; v_audience_segment text;
begin
  if p_artifact_id is null then raise exception 'campaign_set_artifact_status: p_artifact_id is required'; end if;
  if p_status is null or p_status not in ('todo','draft_pending_review','draft','approved','done','blocked') then
    raise exception 'campaign_set_artifact_status: p_status must be one of todo/draft_pending_review/draft/approved/done/blocked';
  end if;
  select sa.shop_id, sa.step_id, sa.discount_pct into v_shop_id, v_step_id, v_discount_pct
    from analytics.step_artifact sa where sa.id = p_artifact_id;
  if v_shop_id is null then raise exception 'campaign_set_artifact_status: artifact % not found', p_artifact_id; end if;
  perform analytics.crm_require_owner_admin(v_shop_id);
  select cs.audience_segment into v_audience_segment from analytics.campaign_step cs where cs.id = v_step_id;
  if v_audience_segment = 'silver_bar' and v_discount_pct is not null then
    raise exception 'campaign_set_artifact_status: silver_bar step artifacts must not carry a discount_pct (rule 1 — arbitrage risk)' using errcode = '22023';
  end if;
  update analytics.step_artifact
    set status = p_status,
        reviewed_by = case when p_status = 'approved' then auth.uid() else reviewed_by end,
        reviewed_at = case when p_status = 'approved' then now() else reviewed_at end,
        updated_by = auth.uid(), updated_at = now()
    where id = p_artifact_id;
end;
$$;

-- R8 — delete a mistyped task. Only manual campaigns: steps that came from a
-- template stay put in phase 1 (deleting one silently breaks the plan's logic).
-- Removing the last step of a content_task takes its wrapper campaign with it
-- so no empty shells accumulate.
create or replace function analytics.campaign_delete_step(p_step_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare v_shop_id uuid; v_campaign_id uuid; v_trigger text; v_type text; v_remaining int;
begin
  if p_step_id is null then raise exception 'campaign_delete_step: p_step_id is required'; end if;
  select cs.shop_id, cs.campaign_id, cp.trigger_kind, cp.campaign_type
    into v_shop_id, v_campaign_id, v_trigger, v_type
  from analytics.campaign_step cs
  join analytics.campaign cp on cp.id = cs.campaign_id
  where cs.id = p_step_id;
  if v_shop_id is null then raise exception 'campaign_delete_step: step % not found', p_step_id; end if;
  perform analytics.crm_require_owner_admin(v_shop_id);

  if v_trigger <> 'manual' then
    raise exception 'campaign_delete_step: only manually-created tasks can be deleted (this step belongs to a template plan)'
      using errcode = '22023';
  end if;

  delete from analytics.campaign_step where id = p_step_id;

  select count(*) into v_remaining from analytics.campaign_step where campaign_id = v_campaign_id;
  if v_remaining = 0 and v_type = 'content_task' then
    delete from analytics.campaign where id = v_campaign_id;
  end if;
end;
$$;

revoke execute on function analytics.campaign_create_from_template(uuid, text, date, text, text) from public, anon, authenticated;
grant execute on function analytics.campaign_create_from_template(uuid, text, date, text, text) to authenticated, service_role;
revoke execute on function analytics.campaign_create_task(uuid, text, date, text, uuid, text) from public, anon, authenticated;
grant execute on function analytics.campaign_create_task(uuid, text, date, text, uuid, text) to authenticated, service_role;
revoke execute on function analytics.campaign_reschedule_step(uuid, date) from public, anon, authenticated;
grant execute on function analytics.campaign_reschedule_step(uuid, date) to authenticated, service_role;
revoke execute on function analytics.campaign_set_artifact_content(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function analytics.campaign_set_artifact_content(uuid, text, jsonb) to authenticated, service_role;
revoke execute on function analytics.campaign_ai_draft_artifact(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function analytics.campaign_ai_draft_artifact(uuid, text, jsonb, text) to authenticated, service_role;
revoke execute on function analytics.campaign_toggle_clip_shot(uuid, text, boolean) from public, anon, authenticated;
grant execute on function analytics.campaign_toggle_clip_shot(uuid, text, boolean) to authenticated, service_role;
revoke execute on function analytics.campaign_set_artifact_status(uuid, text) from public, anon, authenticated;
grant execute on function analytics.campaign_set_artifact_status(uuid, text) to authenticated, service_role;
revoke execute on function analytics.campaign_delete_step(uuid) from public, anon, authenticated;
grant execute on function analytics.campaign_delete_step(uuid) to authenticated, service_role;
revoke execute on function analytics.assert_clip_brief_valid(jsonb) from public, anon;

-- ============================================================================
-- 5. v_campaign_board — same view as 0053 plus step_title / source_reco_key at
--    the END of the column list, and the new artifact fields inside the
--    artifacts json. Column names/types/order before those two are untouched,
--    which is what CREATE OR REPLACE VIEW requires and what keeps 0049's
--    grants (and every existing caller) working.
-- ============================================================================

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
  cp.source_reco_key
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
