-- 0027_marketing_activation.sql
-- Phase B3a + B3b (+ B3c scaffold) — Marketing Activation DB layer, per:
--   docs/3j-jewelry/analytics/phase-b3-design.md
--     §1 (ad spend entry model) · §3 (ROAS/CAC definitions) ·
--     §4 (recommendation engine + mkt_reco_decision) · §6.6 (mkt_budget_proposal)
--
-- Scope of this file (backend-dev / Han Solo):
--   1. RPC analytics.mkt_upsert_ad_spend — date-range spend entry, split evenly
--      across days, upserted against fact_ad_spend's expression-index key.
--   2. analytics.v_channel_perf_roas — month x channel spend/ROAS/CAC (new view,
--      v_channel_perf_monthly from 0020 is left untouched — CRM overview still
--      reads it, and its ROAS/CAC logic already lives client-side in the CRM
--      UI; replacing it here would risk breaking that page for no B3 benefit).
--   3. analytics.v_ad_spend_weekly — weekly rollup for the /marketing/ad-spend
--      entry-history table.
--   4. analytics.v_marketing_reco — rule-based recommendation feed (R0-R3, R6
--      live; R4/R5 emitted as explicitly-blocked rows, see §4 below).
--   5. analytics.mkt_reco_decision — approve/dismiss persistence (direct RLS
--      write, no RPC — this is a preference, not a data edit, per design §4).
--   6. analytics.mkt_budget_proposal — B3c scaffold table only, no proposal-
--      generation logic yet (design §6.6 "จังหวะที่ 1").
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

-- ============================================================================
-- 1. RPC: analytics.mkt_upsert_ad_spend (design §1.1 / §1.2 option ค)
--
-- DECISION vs design doc: §1.2's gotcha note says "security invoker พอ — RLS
-- จัดการสิทธิ์เอง". Verified against 0018_analytics_grants.sql: `authenticated`
-- only has a blanket SELECT grant on `schema analytics` tables (no INSERT/
-- UPDATE table-level grant anywhere) — RLS policies alone are not reachable by
-- `authenticated` without the underlying table privilege, so a SECURITY
-- INVOKER function would fail with "permission denied for table
-- fact_ad_spend" regardless of the owner_admin_insert/update RLS policies
-- from 0012. SECURITY DEFINER (running as the function owner, who has full
-- table privilege) is therefore required, not just a style choice — this also
-- matches the established pattern of every other write RPC in this repo
-- (0021's crm_* functions). Reuses analytics.crm_require_owner_admin (0021)
-- rather than re-deriving the same membership check inline.
-- ============================================================================

create or replace function analytics.mkt_upsert_ad_spend(
  p_shop_id uuid,
  p_channel_id uuid,
  p_date_from date,
  p_date_to date,
  p_amount numeric,
  p_impressions bigint default null,
  p_clicks bigint default null
)
 returns table(days_written int, amount_per_day numeric)
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_days int;
  v_base_amount numeric(12, 2);
  v_last_amount numeric(12, 2);
  v_base_impr bigint;
  v_last_impr bigint;
  v_base_clicks bigint;
  v_last_clicks bigint;
  v_date date;
  v_written int := 0;
begin
  if p_shop_id is null or p_channel_id is null or p_date_from is null
     or p_date_to is null or p_amount is null then
    raise exception 'mkt_upsert_ad_spend: p_shop_id, p_channel_id, p_date_from, p_date_to, p_amount are required';
  end if;
  if p_date_from > p_date_to then
    raise exception 'mkt_upsert_ad_spend: p_date_from (%) must be <= p_date_to (%)', p_date_from, p_date_to;
  end if;
  if p_amount < 0 then
    raise exception 'mkt_upsert_ad_spend: p_amount must be >= 0';
  end if;
  if p_impressions is not null and p_impressions < 0 then
    raise exception 'mkt_upsert_ad_spend: p_impressions must be >= 0';
  end if;
  if p_clicks is not null and p_clicks < 0 then
    raise exception 'mkt_upsert_ad_spend: p_clicks must be >= 0';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  v_days := (p_date_to - p_date_from) + 1;

  -- Even split across the range; the rounding remainder is folded into the
  -- LAST day so sum(daily rows) always reconciles exactly to p_amount
  -- (design §1.2 option ค — "หารเฉลี่ยลงรายวันเท่าๆ กัน").
  v_base_amount := round(p_amount / v_days, 2);
  v_last_amount := p_amount - (v_base_amount * (v_days - 1));

  if p_impressions is not null then
    v_base_impr := p_impressions / v_days;
    v_last_impr := p_impressions - (v_base_impr * (v_days - 1));
  end if;
  if p_clicks is not null then
    v_base_clicks := p_clicks / v_days;
    v_last_clicks := p_clicks - (v_base_clicks * (v_days - 1));
  end if;

  v_date := p_date_from;
  while v_date <= p_date_to loop
    insert into analytics.fact_ad_spend (
      shop_id, spend_date, channel_id, campaign_id, spend_amount, impressions, clicks, entry_method
    ) values (
      p_shop_id, v_date, p_channel_id, null,
      case when v_date = p_date_to then v_last_amount else v_base_amount end,
      case when p_impressions is null then null when v_date = p_date_to then v_last_impr else v_base_impr end,
      case when p_clicks is null then null when v_date = p_date_to then v_last_clicks else v_base_clicks end,
      'manual'
    )
    -- Target expression must match uq_fact_ad_spend_upsert_key (0010) exactly —
    -- this is the whole reason this write goes through an RPC instead of
    -- PostgREST's .upsert({onConflict}), which cannot target an expression index.
    on conflict (shop_id, spend_date, channel_id, coalesce(campaign_id, uuid_nil()))
    do update set
      spend_amount = excluded.spend_amount,
      impressions = excluded.impressions,
      clicks = excluded.clicks,
      entry_method = 'manual',
      updated_at = now();
    v_written := v_written + 1;
    v_date := v_date + 1;
  end loop;

  return query select v_written, v_base_amount;
end;
$$;

revoke execute on function analytics.mkt_upsert_ad_spend(uuid, uuid, date, date, numeric, bigint, bigint)
  from public, anon, authenticated;
grant execute on function analytics.mkt_upsert_ad_spend(uuid, uuid, date, date, numeric, bigint, bigint)
  to authenticated, service_role;

-- ============================================================================
-- 2. v_channel_perf_roas (design §3) — month x channel, spend/ROAS/CAC.
--    New view, does NOT replace v_channel_perf_monthly (0020) — see file
--    header for why. security_invoker=true, null-safe division throughout
--    (no spend row for a month -> roas/profit_roas/cac all NULL, never 0 or
--    infinity, so the UI can render "ไม่มีข้อมูลค่าแอด" per design §3).
-- ============================================================================

create or replace view analytics.v_channel_perf_roas
  with (security_invoker = true) as
with orders_agg as (
  select
    v.shop_id,
    date_trunc('month', v.order_date)::date as month,
    v.channel_id,
    count(*) as orders,
    sum(v.revenue) as revenue,
    count(*) filter (where v.is_new_customer) as new_customers
  from analytics.v_fact_order v
  group by v.shop_id, date_trunc('month', v.order_date), v.channel_id
),
spend_agg as (
  select
    fa.shop_id,
    date_trunc('month', fa.spend_date)::date as month,
    fa.channel_id,
    sum(fa.spend_amount) as spend
  from analytics.fact_ad_spend fa
  group by fa.shop_id, date_trunc('month', fa.spend_date), fa.channel_id
),
combined as (
  select
    coalesce(o.shop_id, s.shop_id) as shop_id,
    coalesce(o.month, s.month) as month,
    coalesce(o.channel_id, s.channel_id) as channel_id,
    coalesce(o.orders, 0) as orders,
    coalesce(o.revenue, 0) as revenue,
    coalesce(o.new_customers, 0) as new_customers,
    s.spend as spend
  from orders_agg o
  full outer join spend_agg s
    on s.shop_id = o.shop_id and s.month = o.month and s.channel_id = o.channel_id
)
select
  c.shop_id,
  c.month,
  dch.code as channel_code,
  dch.name as channel_name,
  c.orders,
  c.revenue,
  case when c.orders > 0 then round(c.revenue / c.orders, 2) else null end as aov,
  c.new_customers,
  c.spend,
  -- roas/profit_roas/cac: NULL when spend is absent or zero, per design §3's
  -- explicit "ห้ามโชว์ 0 หรือ infinity" rule.
  case when c.spend is not null and c.spend <> 0 then round(c.revenue / c.spend, 2) else null end as roas,
  -- profit_roas: ALWAYS an estimate (20% margin placeholder, same debt as
  -- v_customer_ltv.profit_sum in 0020) — UI must label "ประมาณการ".
  case when c.spend is not null and c.spend <> 0
    then round((c.revenue * 0.20) / c.spend, 2) else null end as profit_roas,
  case when c.spend is not null and c.new_customers <> 0
    then round(c.spend / c.new_customers, 2) else null end as cac
from combined c
join analytics.dim_channel dch on dch.id = c.channel_id;

-- ============================================================================
-- 3. v_ad_spend_weekly (design §3) — for the /marketing/ad-spend entry-history
--    table. Grouped by ISO week (date_trunc('week', ...), Monday-start).
-- ============================================================================

create or replace view analytics.v_ad_spend_weekly
  with (security_invoker = true) as
select
  fa.shop_id,
  date_trunc('week', fa.spend_date)::date as week_start,
  (date_trunc('week', fa.spend_date)::date + interval '6 days')::date as week_end,
  dch.code as channel_code,
  dch.name as channel_name,
  sum(fa.spend_amount) as spend,
  sum(fa.impressions) as impressions,
  sum(fa.clicks) as clicks,
  count(*) as days_entered
from analytics.fact_ad_spend fa
join analytics.dim_channel dch on dch.id = fa.channel_id
group by fa.shop_id, date_trunc('week', fa.spend_date), dch.code, dch.name;

-- ============================================================================
-- 4. v_marketing_reco (design §4) — rule-based recommendation feed.
--    Rules implemented live: R0 spend_missing, R1 winback_at_risk, R2
--    geo_focus, R3 cac_vs_aov, R6 live_targeting_brief.
--    R4 roas_drop and R5 lookalike_seed are emitted as explicitly-BLOCKED rows
--    (is_blocked=true + blocked_reason) rather than computed — per design §4
--    R4 needs >=2 months of spend history (data doesn't exist yet at any shop
--    today) and R5 needs PDPA consent that doesn't exist (§5: 0/238 customers
--    have pdpa_consent=true). A blocked card still tells the owner WHY,
--    instead of silently having no row at all.
--
--    Column shape shared by every branch: shop_id, reco_key (rule_code+period,
--    deterministic so the same period's dismiss/approve reattaches on re-open
--    per design §4), rule_code, severity, priority (int, for card sort order),
--    title, detail (jsonb payload for CopilotCard), is_blocked, blocked_reason.
-- ============================================================================

create or replace view analytics.v_marketing_reco
  with (security_invoker = true) as
with province_stats as (
  -- last-60-days province performance, TH-XX (unknown) excluded — an unknown
  -- province is never a valid geo-targeting recommendation.
  select
    v.shop_id,
    v.province_code,
    count(*) as orders,
    sum(v.revenue) as revenue,
    round(sum(v.revenue) / count(*), 2) as aov
  from analytics.v_fact_order v
  where v.order_date >= current_date - interval '60 days'
    and v.province_code <> 'TH-XX'
  group by v.shop_id, v.province_code
),
province_median as (
  select shop_id, percentile_cont(0.5) within group (order by aov) as median_aov
  from province_stats
  group by shop_id
),
channel_roas_latest as (
  select
    r.*,
    row_number() over (partition by r.shop_id, r.channel_code order by r.month desc) as rn
  from analytics.v_channel_perf_roas r
  where r.spend is not null
),
geo_top as (
  select
    v.shop_id,
    v.channel_id,
    v.province_code,
    count(*) as orders,
    sum(v.revenue) as revenue,
    round(sum(v.revenue) / count(*), 2) as aov,
    row_number() over (partition by v.shop_id, v.channel_id order by count(*) desc) as rn
  from analytics.v_fact_order v
  where v.province_code <> 'TH-XX'
  group by v.shop_id, v.channel_id, v.province_code
),
geo_agg as (
  select
    gt.shop_id,
    gt.channel_id,
    jsonb_agg(
      jsonb_build_object(
        'province_code', gt.province_code,
        'province_name', coalesce(g.province_name_th, gt.province_code),
        'orders', gt.orders,
        'revenue', gt.revenue,
        'aov', gt.aov
      )
      order by gt.orders desc
    ) as top_provinces
  from geo_top gt
  left join analytics.dim_geo g on g.province_code = gt.province_code
  where gt.rn <= 5
  group by gt.shop_id, gt.channel_id
),
segment_counts as (
  -- distinct customers per (shop, channel, segment) — LEFT JOIN so a customer
  -- with no RFM row yet (e.g. edge-case transform gap) still counts as
  -- 'unknown' rather than silently dropping out of the mix.
  select
    fo.shop_id,
    fo.channel_id,
    coalesce(rfm.segment, 'unknown') as segment,
    count(distinct fo.customer_id) as customers
  from analytics.v_fact_order fo
  left join analytics.v_rfm_segment rfm on rfm.customer_id = fo.customer_id
  where fo.customer_id is not null
  group by fo.shop_id, fo.channel_id, coalesce(rfm.segment, 'unknown')
),
segment_agg as (
  select shop_id, channel_id, jsonb_object_agg(segment, customers) as segment_mix
  from segment_counts
  group by shop_id, channel_id
),
time_agg as (
  select
    v.shop_id,
    v.channel_id,
    jsonb_agg(jsonb_build_object('hour', hr, 'orders', orders) order by orders desc) as hourly_orders
  from (
    select
      shop_id, channel_id,
      extract(hour from paid_at)::int as hr,
      count(*) as orders
    from analytics.v_fact_order
    where paid_at is not null
    group by shop_id, channel_id, extract(hour from paid_at)
  ) v
  group by v.shop_id, v.channel_id
),
r0 as (
  select
    s.id as shop_id,
    'spend_missing:' || to_char(current_date, 'YYYY-MM') as reco_key,
    'spend_missing' as rule_code,
    'blocker' as severity,
    0 as priority,
    'กรอกค่าแอดก่อน — ROAS ทุกใบข้างล่างรอข้อมูลนี้' as title,
    jsonb_build_object('checked_at', current_date, 'window_days', 14) as detail,
    false as is_blocked,
    null::text as blocked_reason
  from public.shop s
  where not exists (
    select 1 from analytics.fact_ad_spend fa
    where fa.shop_id = s.id and fa.spend_date >= current_date - interval '14 days'
  )
),
r1 as (
  select
    rfm.shop_id,
    'winback_at_risk:' || to_char(current_date, 'YYYY-MM') as reco_key,
    'winback_at_risk' as rule_code,
    'high' as severity,
    1 as priority,
    'ลูกค้าเสี่ยงหาย ' || count(*) || ' คน — ส่ง win-back broadcast ทาง LINE (AOV LINE สูงกว่าช่องอื่นราว 3 เท่า)' as title,
    jsonb_build_object('at_risk_count', count(*), 'segment', 'at_risk') as detail,
    false as is_blocked,
    null::text as blocked_reason
  from analytics.v_rfm_segment rfm
  where rfm.segment = 'at_risk'
  group by rfm.shop_id
  having count(*) >= 20
),
r2 as (
  select
    ps.shop_id,
    'geo_focus:' || ps.province_code || ':' || to_char(current_date, 'YYYY-MM') as reco_key,
    'geo_focus' as rule_code,
    'medium' as severity,
    2 as priority,
    'จังหวัด ' || coalesce(g.province_name_th, ps.province_code) || ' AOV สูงกว่าค่ากลาง ' ||
      round((ps.aov / nullif(pm.median_aov, 0))::numeric, 1) || ' เท่า — เพิ่ม geo-bid จังหวัดนี้' as title,
    jsonb_build_object(
      'province_code', ps.province_code,
      'province_name', g.province_name_th,
      'orders_60d', ps.orders,
      'aov', ps.aov,
      'median_aov', pm.median_aov
    ) as detail,
    false as is_blocked,
    null::text as blocked_reason
  from province_stats ps
  join province_median pm on pm.shop_id = ps.shop_id
  left join analytics.dim_geo g on g.province_code = ps.province_code
  where ps.orders >= 5 and pm.median_aov > 0 and ps.aov >= 1.5 * pm.median_aov
),
r3 as (
  select
    l.shop_id,
    'cac_vs_aov:' || l.channel_code || ':' || to_char(l.month, 'YYYY-MM') as reco_key,
    'cac_vs_aov' as rule_code,
    'medium' as severity,
    2 as priority,
    'ช่องทาง ' || l.channel_name || ' จ่ายแพงกว่าที่ลูกค้าซื้อ (CAC ' || l.cac || ' > AOV ' || l.aov || ') — ทบทวนงบ' as title,
    jsonb_build_object(
      'channel_code', l.channel_code, 'month', l.month,
      'cac', l.cac, 'aov', l.aov, 'spend', l.spend
    ) as detail,
    false as is_blocked,
    null::text as blocked_reason
  from channel_roas_latest l
  where l.rn = 1 and l.cac is not null and l.aov is not null and l.cac > l.aov
),
r4_blocked as (
  -- roas_drop needs >=2 months of spend to compare MoM (design §4 R4). Emit a
  -- blocked card only for shops that HAVE started entering spend (so it's not
  -- noise before R0 is even resolved), but don't have 2 distinct months yet.
  select
    fa.shop_id,
    'roas_drop:blocked' as reco_key,
    'roas_drop' as rule_code,
    'info' as severity,
    3 as priority,
    'ตรวจจับ ROAS ตก (MoM) — ยังใช้งานไม่ได้' as title,
    jsonb_build_object('spend_months_available', count(distinct date_trunc('month', fa.spend_date))) as detail,
    true as is_blocked,
    'ต้องมีค่าแอดสะสมอย่างน้อย 2 เดือนถึงจะเทียบ ROAS เดือนต่อเดือนได้' as blocked_reason
  from analytics.fact_ad_spend fa
  group by fa.shop_id
  having count(distinct date_trunc('month', fa.spend_date)) < 2
),
r5_blocked as (
  -- lookalike_seed needs PDPA consent (design §5: 0/238 customers consented
  -- today) — always blocked until a consent-collection flow exists.
  select
    rfm.shop_id,
    'lookalike_seed:blocked' as reco_key,
    'lookalike_seed' as rule_code,
    'info' as severity,
    3 as priority,
    'ส่งออก lookalike seed audience — ยังใช้งานไม่ได้' as title,
    jsonb_build_object('champion_count', count(*)) as detail,
    true as is_blocked,
    'รอ PDPA consent (ยังไม่มีลูกค้ารายใดยินยอม) และ platform match ได้เฉพาะเบอร์จริง — TikTok mask เบอร์ ใช้ได้แค่ LINE' as blocked_reason
  from analytics.v_rfm_segment rfm
  where rfm.segment = 'champion'
  group by rfm.shop_id
  having count(*) >= 10
),
r6 as (
  select
    fo.shop_id,
    'live_targeting_brief:' || dch.code || ':' || to_char(current_date, 'YYYY-MM') as reco_key,
    'live_targeting_brief' as rule_code,
    'info' as severity,
    2 as priority,
    'ยิงแอดโปรโมตไลฟ์ ' || dch.name || ' — brief จังหวัด/กลุ่มลูกค้า/ช่วงเวลาพร้อมใช้ใน Ads Manager' as title,
    jsonb_build_object(
      'channel_code', dch.code,
      'top_provinces', coalesce(ga.top_provinces, '[]'::jsonb),
      'segment_mix', coalesce(sa.segment_mix, '{}'::jsonb),
      'hourly_orders', coalesce(ta.hourly_orders, '[]'::jsonb)
    ) as detail,
    false as is_blocked,
    null::text as blocked_reason
  from (select distinct shop_id, channel_id from analytics.v_fact_order) fo
  join analytics.dim_channel dch on dch.id = fo.channel_id
  left join geo_agg ga on ga.shop_id = fo.shop_id and ga.channel_id = fo.channel_id
  left join segment_agg sa on sa.shop_id = fo.shop_id and sa.channel_id = fo.channel_id
  left join time_agg ta on ta.shop_id = fo.shop_id and ta.channel_id = fo.channel_id
)
select * from r0
union all select * from r1
union all select * from r2
union all select * from r3
union all select * from r4_blocked
union all select * from r5_blocked
union all select * from r6;

-- ============================================================================
-- 5. mkt_reco_decision (design §4) — approve/dismiss, DB-backed (upgrade from
--    the TikTok copilot's localStorage-only pattern). Direct RLS write, no
--    RPC: this is a per-user preference on a live-recomputed view, not an
--    edit to underlying data — no audit trail needed (design §4 explicit
--    trade-off vs the RPC+audit pattern used for real data edits in B2).
-- ============================================================================

create table analytics.mkt_reco_decision (
  shop_id uuid not null references public.shop (id) on delete cascade,
  reco_key text not null,
  status text not null check (status in ('approved', 'dismissed')),
  dismiss_reason text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (shop_id, reco_key)
);

alter table analytics.mkt_reco_decision enable row level security;

create policy tenant_isolation_select on analytics.mkt_reco_decision
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

create policy owner_admin_insert on analytics.mkt_reco_decision
  for insert
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_update on analytics.mkt_reco_decision
  for update
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_delete on analytics.mkt_reco_decision
  for delete
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- IMPORTANT: 0018_analytics_grants.sql only grants `authenticated` a blanket
-- SELECT on `all tables in schema analytics` — the RLS write policies above
-- are unreachable without the matching table-level privilege. Every prior
-- write path in this schema went through a SECURITY DEFINER RPC (which runs
-- as the function owner and doesn't need this), so this is the first table
-- in `analytics` that needs an explicit non-SELECT grant to `authenticated`.
grant insert, update, delete on analytics.mkt_reco_decision to authenticated;

-- ============================================================================
-- 6. mkt_budget_proposal (design §6.6) — B3c SCAFFOLD ONLY. No
--    proposal-generation logic in this migration (that's the "จังหวะที่ 1"
--    server action, a future phase) — table + RLS exist so the DDL doesn't
--    block that work later.
--
--    RLS: SELECT = tenant member. Insert of new `proposed` rows is NOT opened
--    to `authenticated` here — design §6.6 only specifies "approve/reject =
--    owner เท่านั้น"; proposal creation is described as a server-action
--    computing from a formula, which in this codebase's current auth model
--    runs under the service-role key (already has full grant + bypasses RLS
--    per 0018) rather than as an end-user table write. If a future phase adds
--    an end-user "create proposal" UI, that needs its own explicit insert
--    policy — flagged here, not assumed.
-- ============================================================================

create table analytics.mkt_budget_proposal (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  channel_id uuid not null references analytics.dim_channel (id) on delete restrict,
  period date not null,
  suggested_amount numeric(12, 2) not null check (suggested_amount >= 0),
  rationale jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  approved_amount numeric(12, 2),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint uq_mkt_budget_proposal_shop_channel_period unique (shop_id, channel_id, period)
);

create index idx_mkt_budget_proposal_shop_id on analytics.mkt_budget_proposal (shop_id);

alter table analytics.mkt_budget_proposal enable row level security;

create policy tenant_isolation_select on analytics.mkt_budget_proposal
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- Approve/reject = OWNER only (not admin) — real money, deliberately narrower
-- than the owner/admin pattern used everywhere else in this schema (design
-- §6.6: "แคบกว่า admin เพราะเงินจริง"). This policy also governs any other
-- column change (e.g. approved_amount) an owner makes at decision time.
create policy owner_decide on analytics.mkt_budget_proposal
  for update
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- Same table-level grant gap as mkt_reco_decision above (0018 only grants
-- SELECT) — only UPDATE is needed here since there is no authenticated INSERT
-- policy on this table (see note above).
grant update on analytics.mkt_budget_proposal to authenticated;

-- ============================================================================
-- 7. Grants — re-run the blanket SELECT grant so it covers the two new views
--    (v_channel_perf_roas, v_ad_spend_weekly, v_marketing_reco) and two new
--    tables created above. Views/tables created after 0018/0020 don't
--    retroactively inherit that grant.
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;
