-- 0101_recommendation_log.sql
-- Measurement layer for the CEO's 90-day gate metric: "recommendation
-- acceptance rate >= 60%" (docs/3j-jewelry/marketing/ai-marketing-os-decision-31aug.md
-- §3.2, §5.3). Today there is nowhere that records what the AI/team proposed
-- to the owner and whether it was acted on — without this table, day 90
-- can't answer the question the whole gate depends on, and anything logged
-- before this migration ships is lost for good (no backfill possible).
--
-- Scope of this file (backend-dev / Han Solo):
--   1. analytics.recommendation_log — one row per proposal, single mutable
--      terminal-state column (see design note below re: event-log question).
--   2. analytics.campaign gains hypothesis/result_note/result_verdict
--      (additive only — NO A/B experiment engine; CEO NO-GO on that per §0.5,
--      334 orders/month isn't enough for statistical significance per CFO).
--   3. analytics.v_recommendation_acceptance — done / (done+rejected+expired)
--      by month (Asia/Bangkok) x source. pending never counts in the
--      denominator (undecided != rejected).
--
-- ============================================================================
-- Design decision flagged per brief instructions ("ถ้าคิดว่า owner_action
-- ควรเป็นตารางแยก (event log) แทน enum เดียว บอกมาพร้อมเหตุผล"):
--
-- Kept as a single mutable enum column, NOT a separate event-log table.
-- Reasoning:
--   - The source doc explicitly asks for "แบบเบาสุด" (§5.3) — a proposal has
--     exactly one terminal transition (pending -> done/rejected/expired), not
--     a multi-step workflow. There's no requirement to reconstruct "it was
--     rejected on day 3 then someone changed it to done on day 10" — only
--     the final state feeds the KPI.
--   - Direct precedent already in this schema: analytics.mkt_reco_decision
--     (0027) uses the same single-status pattern (approved/dismissed) for a
--     structurally identical problem (did the owner act on a suggestion?)
--     and has never needed an event history.
--   - An event-log table doubles the write surface (every state change is an
--     insert instead of an update) for zero query benefit today, and the
--     CEO's own guardrail is "cache 24h, no re-analyze, no loops" — this is
--     the kind of scope-creep the 90-day plan explicitly guards against
--     (§0.5: "ห้ามสร้าง OS ใหม่ขนานกับ 3J Insight").
--   If a future need shows up for "who flip-flopped this decision and when"
--   (e.g. disputing the day-90 number), add updated_by/updated_at (already
--   included below) first — full event sourcing is a much bigger jump than
--   this table needs to earn.
--
-- Second decision flagged (not explicitly asked, but affects whether the
-- metric can ever be computed): 'expired' is a state nobody will remember to
-- set by hand, and adding a scheduled job to flip it is exactly the kind of
-- new automation the plan's guardrails discourage this quarter (§4: no new
-- scheduled jobs without a cost log/kill switch review). So:
--   - owner_action can still be set to 'expired' explicitly (e.g. a future
--     UI "mark as expired" button, or a human batch cleanup) — the value is
--     real and stays in the table as entered.
--   - analytics.v_recommendation_acceptance ALSO treats any row that is
--     still 'pending' after 14 days (Thailand-day-boundary-agnostic; this is
--     an elapsed-time check, not a calendar-day one, so plain now()-created_at
--     is correct here — Asia/Bangkok conversion is only needed for the month
--     bucketing below) as 'expired' for the purposes of the rate calculation
--     ONLY. It does not mutate the underlying row — analytics.recommendation_log
--     always reflects literally what was recorded, so no silent data
--     rewriting, but the KPI still comes out correct without a cron job.
--   14 days is my judgment call (roughly "two weekly briefs," since each
--   brief's actions are meant to be done within that week per §5 pt.2) —
--   not something CEO/CMO signed off on. Tech Lead should confirm this
--   threshold before the day-90 review runs off this view.
-- ============================================================================

-- ============================================================================
-- 1. analytics.recommendation_log
-- ============================================================================

create table analytics.recommendation_log (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  source text not null check (source in ('weekly_brief', 'agent', 'adhoc')),
  title text not null check (char_length(btrim(title)) > 0),
  detail text not null check (char_length(btrim(detail)) > 0),
  owner_action text not null default 'pending' check (
    owner_action in ('pending', 'done', 'rejected', 'expired')
  ),
  -- CEO's "<=15 min/item" rule (§4 governance) is a process guideline for
  -- what SHOULD be proposed, not a DB gate here: rejecting a logged estimate
  -- that turns out to exceed 15 min would hide exactly the signal ("this
  -- recommendation broke the time budget") the log exists to catch. Only a
  -- generous sanity ceiling (8h) guards against a fat-fingered entry, same
  -- spirit as the NaN/Infinity guard pattern in this schema.
  effort_minutes_est int check (
    effort_minutes_est is null or (effort_minutes_est > 0 and effort_minutes_est <= 480)
  ),
  related_campaign_id uuid references analytics.campaign (id) on delete set null,
  acted_at timestamptz,
  acted_by uuid references auth.users (id) on delete set null,
  outcome_note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- acted_at must be present iff a terminal decision has been recorded —
  -- catches "marked done but forgot acted_at" and "acted_at backfilled on a
  -- still-pending row" at the data layer instead of trusting app code.
  constraint chk_recommendation_log_acted_consistency check (
    (owner_action = 'pending' and acted_at is null)
    or (owner_action <> 'pending' and acted_at is not null)
  )
);

create index idx_recommendation_log_shop_id on analytics.recommendation_log (shop_id);
create index idx_recommendation_log_shop_created on analytics.recommendation_log (shop_id, created_at);
create index idx_recommendation_log_campaign on analytics.recommendation_log (related_campaign_id)
  where related_campaign_id is not null;

create trigger trg_recommendation_log_updated_at
  before update on analytics.recommendation_log
  for each row execute function public.set_updated_at();

alter table analytics.recommendation_log enable row level security;

create policy tenant_isolation_select on analytics.recommendation_log
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

create policy owner_admin_insert on analytics.recommendation_log
  for insert
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_update on analytics.recommendation_log
  for update
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- Delete intentionally has an RLS policy (defense-in-depth, same as every
-- other table in this schema) but is deliberately NOT granted to
-- `authenticated` below. This table exists to protect the honesty of a KPI
-- the owner is graded on — a self-service delete would let an inconvenient
-- 'rejected'/'expired' row quietly disappear before day 90. Corrections, if
-- ever needed, go through service_role (already has full DML per 0018's
-- default privileges), not a PostgREST call an end user can make.
create policy owner_admin_delete on analytics.recommendation_log
  for delete
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- Unlike analytics.campaign (0049), this table has no cross-row business
-- rule that needs a SECURITY DEFINER RPC to enforce (the only invariant,
-- acted_at-consistency, is a plain CHECK constraint that holds regardless of
-- write path) — same shape as analytics.mkt_reco_decision (0027), so it gets
-- the same direct-grant treatment. INSERT: logging a new proposal (weekly
-- brief agent run, or a human logging an ad-hoc one). UPDATE: owner marking
-- done/rejected/expired later. DELETE is withheld per the policy comment
-- above.
grant insert, update on analytics.recommendation_log to authenticated;

-- ============================================================================
-- 2. analytics.campaign — hypothesis + real outcome (additive only, per
--    0.5/1.2/5 pt.4: A/B engine is NO-GO, this replaces it). Existing rows
--    get result_verdict='not_measured', which is literally true for them —
--    hypothesis/result_note stay NULL (no honest default text exists for
--    campaigns that predate this column).
--
--    No DB-level gate requiring hypothesis before a campaign goes 'active':
--    doing that retroactively would either break every already-active
--    campaign row or need a fabricated backfill value, both worse than the
--    gap. "every campaign has hypothesis before / result after" (§3 KPI 4)
--    is tracked as a query against this table for the day-90 review, not
--    enforced as a hard constraint — same tier as the other process-only
--    guardrails in the plan (e.g. WIP limit, publish-through rate) that
--    aren't encoded in SQL either.
-- ============================================================================

alter table analytics.campaign
  add column hypothesis text,
  add column result_note text,
  add column result_verdict text not null default 'not_measured' check (
    result_verdict in ('validated', 'invalidated', 'inconclusive', 'not_measured')
  );

-- ============================================================================
-- 3. analytics.v_recommendation_acceptance
-- ============================================================================

create or replace view analytics.v_recommendation_acceptance
  with (security_invoker = true) as
with scored as (
  select
    rl.shop_id,
    rl.source,
    rl.created_at,
    case
      when rl.owner_action <> 'pending' then rl.owner_action
      -- elapsed-time check, not a calendar-day one -> plain UTC subtraction
      -- is correct (Asia/Bangkok conversion only matters for month bucketing
      -- below, per skill note #6).
      when now() - rl.created_at > interval '14 days' then 'expired'
      else 'pending'
    end as effective_action
  from analytics.recommendation_log rl
)
select
  shop_id,
  (date_trunc('month', created_at at time zone 'Asia/Bangkok'))::date as month,
  source,
  count(*) filter (where effective_action = 'done') as done_count,
  count(*) filter (where effective_action = 'rejected') as rejected_count,
  count(*) filter (where effective_action = 'expired') as expired_count,
  count(*) filter (where effective_action = 'pending') as pending_count,
  count(*) as total_count,
  round(
    count(*) filter (where effective_action = 'done')::numeric
    / nullif(count(*) filter (where effective_action in ('done', 'rejected', 'expired')), 0),
    4
  ) as acceptance_rate
from scored
group by shop_id, (date_trunc('month', created_at at time zone 'Asia/Bangkok'))::date, source;

-- ============================================================================
-- 4. Grants — same trailing blanket-SELECT re-run every migration in this
--    schema does (0018's default privileges already cover new tables/views;
--    this line is the established idiom for making that explicit/idempotent,
--    see 0049/0099/0100). Covers the new table + view.
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
