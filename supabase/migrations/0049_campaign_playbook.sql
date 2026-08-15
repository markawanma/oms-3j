-- 0049_campaign_playbook.sql
-- Campaign Playbook MVP ("ดูได้ + ติ๊กเสร็จได้") — DB layer, per:
--   docs/3j-jewelry/analytics/phase-campaign-playbook-design.md (architect, Yoda)
--   docs/3j-jewelry/marketing/campaign-playbook-taxonomy.md (CMO, Leia) — §ENUMS is
--   the source of truth for every check-constraint value below, copied verbatim.
--
-- Scope of this file (backend-dev / Han Solo):
--   1. 4 tables (schema analytics): campaign / campaign_step / step_artifact /
--      step_gate — text+CHECK enums (design D2), denormalized shop_id every
--      layer, FK to parent, unique(campaign_id,seq).
--   2. RLS on all 4 — mirrors analytics.hero_watch (0037) / analytics.shop_setting
--      (0028): tenant_isolation SELECT (shop_member) + owner_admin INSERT/UPDATE/
--      DELETE policies exist for defense-in-depth, but (same as those two tables)
--      NO explicit `grant insert/update/delete ... to authenticated` is issued —
--      0018 only ever granted `authenticated` a blanket SELECT on `schema
--      analytics`, so those write policies stay structurally unreachable by the
--      `authenticated` role. The only working write path is the two RPCs below
--      (SECURITY DEFINER, run as the function owner, so they don't need the
--      table grant) — this is deliberate: it's the only way to guarantee rule 1
--      (silver_bar must never carry a discount) can't be bypassed by a raw
--      PostgREST .update() call on step_artifact.
--   3. analytics.v_campaign_board (security_invoker, 1 row per step) — resolves
--      resolved_start/resolved_end/days_until from anchor_date + offsets,
--      audience_live_count from analytics.v_rfm_segment (0020), artifacts/gates
--      as jsonb_agg, art_done/art_total, and effective_status (4-branch logic,
--      see comment on the view below).
--   4. Two write RPCs (SECURITY DEFINER + analytics.crm_require_owner_admin
--      (0021) gate): campaign_set_artifact_status (enforces rule 1) and
--      campaign_pass_gate. Granted to `authenticated, service_role` — same
--      convention as every other write RPC in this schema (crm_*, mkt_*,
--      hero_watch_*); crm_require_owner_admin already short-circuits for
--      service_role (the only caller today, per the app's current
--      no-persona-auth model) and still enforces real membership for any
--      authenticated end user once real auth ships.
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

-- ============================================================================
-- 1. analytics.campaign
-- ============================================================================

create table analytics.campaign (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  name text not null,
  campaign_type text not null check (campaign_type in (
    'promo_event', 'winback', 'second_purchase_nurture', 'live_promo', 'vip_loyalty', 'acquisition'
  )),
  trigger_kind text not null check (trigger_kind in (
    'calendar', 'data_driven', 'recurring', 'always_on'
  )),
  status text not null default 'scheduled' check (status in (
    'active', 'scheduled', 'blocked', 'waiting_data', 'done'
  )),
  anchor_date date,
  primary_channels text[] check (
    primary_channels is null
    or primary_channels <@ array['line_oa', 'tiktok_live', 'shopee', 'facebook', 'parcel_insert']::text[]
  ),
  blocked_reason text,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_campaign_shop_id on analytics.campaign (shop_id);

create trigger trg_campaign_updated_at
  before update on analytics.campaign
  for each row execute function public.set_updated_at();

alter table analytics.campaign enable row level security;

create policy tenant_isolation_select on analytics.campaign
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

create policy owner_admin_insert on analytics.campaign
  for insert
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_update on analytics.campaign
  for update
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_delete on analytics.campaign
  for delete
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 2. analytics.campaign_step
--    step_status (check6) is one MORE state than campaign_status (check5,
--    taxonomy-defined): 'todo' added at the front for a step whose sequence
--    hasn't come up yet (campaign_status has no equivalent "not started" state
--    because a campaign itself is either active/scheduled from day 1). Not in
--    taxonomy verbatim — architect's data model spec says "status check6"
--    without listing values; this is the smallest superset that makes seq
--    ordering ("teaser is todo while main_day hasn't started") representable.
-- ============================================================================

create table analytics.campaign_step (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references analytics.campaign (id) on delete cascade,
  shop_id uuid not null references public.shop (id) on delete cascade,
  seq int not null check (seq > 0),
  step_kind text not null check (step_kind in (
    'teaser', 'vip_private_access', 'main_day', 'last_call', 'post_sale',
    'reconnect', 'segment_offer', 'followup_nudge',
    'pre_live_hook', 'live_session', 'live_highlight_recap',
    'identify', 'personal_outreach', 'perk_fulfillment',
    'remind', 'cross_sell_matching',
    'insert_card', 'live_cta', 'capture_consent', 'close'
  )),
  -- relative offsets from campaign.anchor_date (taxonomy §ชั้น2 "timing =
  -- relative offset"), NOT absolute dates — resolved at read time in
  -- v_campaign_board so a date-shift only ever touches campaign.anchor_date.
  offset_start_days int not null,
  offset_end_days int check (offset_end_days is null or offset_end_days >= offset_start_days),
  audience_segment text check (audience_segment in (
    'champion', 'loyal', 'new', 'at_risk', 'all_followers', 'geo_bkk',
    'silver_bar', 'tiktok_buyer', 'line_follower'
  )),
  channel text check (channel in ('line_oa', 'tiktok_live', 'shopee', 'facebook', 'parcel_insert')),
  goal_kpi text,
  status text not null default 'todo' check (status in (
    'todo', 'scheduled', 'active', 'blocked', 'waiting_data', 'done'
  )),
  blocked_reason text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_campaign_step_campaign_seq unique (campaign_id, seq)
);

create index idx_campaign_step_campaign_id on analytics.campaign_step (campaign_id);
create index idx_campaign_step_shop_id on analytics.campaign_step (shop_id);

create trigger trg_campaign_step_updated_at
  before update on analytics.campaign_step
  for each row execute function public.set_updated_at();

alter table analytics.campaign_step enable row level security;

create policy tenant_isolation_select on analytics.campaign_step
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

create policy owner_admin_insert on analytics.campaign_step
  for insert
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_update on analytics.campaign_step
  for update
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_delete on analytics.campaign_step
  for delete
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 3. analytics.step_artifact
--    discount_pct kept as its own numeric column (not parsed out of note/
--    source_doc free text) specifically so campaign_set_artifact_status can
--    enforce rule 1 (silver_bar must never carry a discount) as a real SQL
--    check instead of a string search (taxonomy §BUSINESS RULES 1).
--    dynamic_source (check5) mirrors taxonomy §"จุดที่ต้องผูกข้อมูลสด" table
--    order exactly: rfm_segment / hero_stock / silver_spot_price /
--    teaser_click_log / attribution_log. Only rfm_segment is actually resolved
--    today (via v_campaign_board's audience_live_count, which reads
--    campaign_step.audience_segment, not this column) — the other four are
--    flags for phase 2 per design D4/§Dependencies; NOT enforced not-null when
--    is_dynamic=true, so seeding attribution_code with is_dynamic=true and no
--    dynamic_source yet is legal (documented debt, not a bug).
-- ============================================================================

create table analytics.step_artifact (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references analytics.campaign_step (id) on delete cascade,
  shop_id uuid not null references public.shop (id) on delete cascade,
  artifact_type text not null check (artifact_type in (
    'broadcast_script_line', 'dm_script_1to1', 'teaser_image', 'cta_button_flex',
    'parcel_card', 'live_rundown', 'attribution_code', 'short_form_clip',
    'live_highlight_clip', 'fb_post', 'bundle_offer_spec'
  )),
  owner_role text not null check (owner_role in (
    'copywriter', 'content_repurposer', 'owner', 'cfo', 'coo', 'tech_lead', 'host'
  )),
  source_doc text,
  status text not null default 'todo' check (status in ('todo', 'draft', 'done', 'blocked')),
  is_dynamic boolean not null default false,
  dynamic_source text check (dynamic_source in (
    'rfm_segment', 'hero_stock', 'silver_spot_price', 'teaser_click_log', 'attribution_log'
  )),
  dynamic_ref text,
  discount_pct numeric(5, 2) check (discount_pct is null or (discount_pct >= 0 and discount_pct <= 100)),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_step_artifact_step_id on analytics.step_artifact (step_id);
create index idx_step_artifact_shop_id on analytics.step_artifact (shop_id);

create trigger trg_step_artifact_updated_at
  before update on analytics.step_artifact
  for each row execute function public.set_updated_at();

alter table analytics.step_artifact enable row level security;

create policy tenant_isolation_select on analytics.step_artifact
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

create policy owner_admin_insert on analytics.step_artifact
  for insert
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_update on analytics.step_artifact
  for update
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_delete on analytics.step_artifact
  for delete
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 4. analytics.step_gate — M:N step<->gate_kind, pk(step_id, gate_kind) per design.
-- ============================================================================

create table analytics.step_gate (
  step_id uuid not null references analytics.campaign_step (id) on delete cascade,
  shop_id uuid not null references public.shop (id) on delete cascade,
  gate_kind text not null check (gate_kind in (
    'cfo_discount_approval', 'coo_stock_check', 'pdpa_consent', 'quota_check', 'price_realtime_fill'
  )),
  status text not null default 'pending' check (status in ('pending', 'passed', 'blocked', 'na')),
  passed_by uuid references auth.users (id) on delete set null,
  passed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (step_id, gate_kind)
);

create index idx_step_gate_step_id on analytics.step_gate (step_id);
create index idx_step_gate_shop_id on analytics.step_gate (shop_id);

create trigger trg_step_gate_updated_at
  before update on analytics.step_gate
  for each row execute function public.set_updated_at();

alter table analytics.step_gate enable row level security;

create policy tenant_isolation_select on analytics.step_gate
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

create policy owner_admin_insert on analytics.step_gate
  for insert
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_update on analytics.step_gate
  for update
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_delete on analytics.step_gate
  for delete
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 5. analytics.v_campaign_board (security_invoker, 1 row per step)
--
-- effective_status precedence (design §Read, 4 branches — do not reorder):
--   1. gate blocked OR artifact blocked (any)                         -> 'blocked'
--   2. audience_segment set AND campaign.trigger_kind='data_driven'
--      AND live_count=0                                               -> 'waiting_data'
--      (covers winback: segment=at_risk, trigger=data_driven, count=0 today)
--   3. audience_segment in (silver_bar,tiktok_buyer,line_follower)
--      AND live_count=0                                               -> 'waiting_data'
--      (these three are structurally absent from v_rfm_segment.segment, so
--      live_count is always 0 until a real data source exists for them —
--      "count 0 without hardcoding", per design D4)
--   4. else                                                           -> step.status
--
-- audience_live_count: LEFT JOIN LATERAL against analytics.v_rfm_segment
-- (0020), grouped by shop_id+segment. NULL (not 0) when the step has no
-- audience_segment at all — 0 would wrongly imply "checked, found none".
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
  case when cs.audience_segment is null then null else coalesce(rfm.live_count, 0) end as audience_live_count,
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
  end as effective_status
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
        'note', sa.note
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

-- ============================================================================
-- 6. Write RPCs
-- ============================================================================

-- campaign_set_artifact_status — the only legal write path to step_artifact.status.
-- Enforces rule 1 (taxonomy §BUSINESS RULES 1): an artifact on a step whose
-- audience_segment='silver_bar' must never carry discount_pct.
create or replace function analytics.campaign_set_artifact_status(
  p_artifact_id uuid,
  p_status text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_shop_id uuid;
  v_step_id uuid;
  v_discount_pct numeric;
  v_audience_segment text;
begin
  if p_artifact_id is null then
    raise exception 'campaign_set_artifact_status: p_artifact_id is required';
  end if;
  if p_status is null or p_status not in ('todo', 'draft', 'done', 'blocked') then
    raise exception 'campaign_set_artifact_status: p_status must be one of todo/draft/done/blocked';
  end if;

  select sa.shop_id, sa.step_id, sa.discount_pct
    into v_shop_id, v_step_id, v_discount_pct
    from analytics.step_artifact sa
    where sa.id = p_artifact_id;
  if v_shop_id is null then
    raise exception 'campaign_set_artifact_status: artifact % not found', p_artifact_id;
  end if;

  perform analytics.crm_require_owner_admin(v_shop_id);

  select cs.audience_segment into v_audience_segment
    from analytics.campaign_step cs where cs.id = v_step_id;

  if v_audience_segment = 'silver_bar' and v_discount_pct is not null then
    raise exception 'campaign_set_artifact_status: silver_bar step artifacts must not carry a discount_pct (rule 1 — arbitrage risk)'
      using errcode = '22023';
  end if;

  update analytics.step_artifact
    set status = p_status, updated_by = auth.uid(), updated_at = now()
    where id = p_artifact_id;
end;
$$;

revoke execute on function analytics.campaign_set_artifact_status(uuid, text) from public, anon, authenticated;
grant execute on function analytics.campaign_set_artifact_status(uuid, text) to authenticated, service_role;

-- campaign_pass_gate — the only legal write path to step_gate.status. Sets
-- status='passed' + passed_by/passed_at. Rejecting an already-passed gate back
-- to pending, or setting 'blocked'/'na', is out of MVP scope (owner review UI
-- is read + tick-done only per task) — left as a documented gap, not silently
-- half-implemented.
create or replace function analytics.campaign_pass_gate(
  p_step_id uuid,
  p_gate_kind text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_shop_id uuid;
begin
  if p_step_id is null or p_gate_kind is null then
    raise exception 'campaign_pass_gate: p_step_id and p_gate_kind are required';
  end if;
  if p_gate_kind not in (
    'cfo_discount_approval', 'coo_stock_check', 'pdpa_consent', 'quota_check', 'price_realtime_fill'
  ) then
    raise exception 'campaign_pass_gate: invalid p_gate_kind %', p_gate_kind;
  end if;

  select cs.shop_id into v_shop_id from analytics.campaign_step cs where cs.id = p_step_id;
  if v_shop_id is null then
    raise exception 'campaign_pass_gate: step % not found', p_step_id;
  end if;

  perform analytics.crm_require_owner_admin(v_shop_id);

  if not exists (
    select 1 from analytics.step_gate sg where sg.step_id = p_step_id and sg.gate_kind = p_gate_kind
  ) then
    raise exception 'campaign_pass_gate: gate % not found on step %', p_gate_kind, p_step_id;
  end if;

  update analytics.step_gate
    set status = 'passed', passed_by = auth.uid(), passed_at = now(), updated_at = now()
    where step_id = p_step_id and gate_kind = p_gate_kind;
end;
$$;

revoke execute on function analytics.campaign_pass_gate(uuid, text) from public, anon, authenticated;
grant execute on function analytics.campaign_pass_gate(uuid, text) to authenticated, service_role;

-- ============================================================================
-- 7. Grants — cover the 4 new tables + v_campaign_board. RLS on the underlying
--    tables still does the real row-level filtering; this only clears the
--    outer "can you touch this relation at all" gate (same as every prior
--    migration's trailing grant).
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
