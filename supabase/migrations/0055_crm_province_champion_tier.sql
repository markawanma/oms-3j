-- 0055_crm_province_champion_tier.sql
-- CRM customer-page enhancement (DB layer only, per Tech Lead handoff):
--   1. Customer province — real Thai province name instead of the raw
--      TH-40-style code, for both /crm/customers (list) and the customer
--      order history (per-order province was already exposed as a code).
--   2. Champion split into two value tiers — 'high' (VIP, revenue_sum > 5000)
--      vs 'core' (everyone else already meeting the champion bar). This is a
--      NEW column (value_tier), NOT a change to the existing `segment` column
--      — dashboard/audience/campaign already read v_rfm_segment.segment and
--      must not shift under them.
--
-- ⚠️ DO NOT APPLY — file only. Tech Lead applies via MCP.
--
-- Both views below are `create or replace view ... with (security_invoker =
-- true)`, same invoker-security requirement as 0020 (RLS on the underlying
-- tables must evaluate as the querying role, not the view owner) — grants are
-- unchanged, 0020's `grant select on all tables in schema analytics to
-- authenticated, service_role` already covers views created/replaced later in
-- the same schema.

-- ============================================================================
-- 1. analytics.v_rfm_segment — add value_tier (champion split)
-- ============================================================================
--
-- Every existing column + the `segment` case (including the untouched
-- 'champion' branch) is copied verbatim from 0020_crm_b1_views.sql lines
-- 293-335. Only new column: value_tier, appended at the end.
create or replace view analytics.v_rfm_segment
  with (security_invoker = true) as
select
  cm.customer_id,
  cm.shop_id,
  cm.display_name,
  cm.order_count as frequency,
  cm.revenue_sum as monetary,
  cm.last_order_at,
  case when cm.last_order_at is null then null
    else extract(day from (now() - cm.last_order_at::timestamptz))::int
  end as recency_days,
  case
    when cm.last_order_at is null then null
    when now() - cm.last_order_at::timestamptz < interval '30 days' then 3
    when now() - cm.last_order_at::timestamptz <= interval '90 days' then 2
    else 1
  end as r_score,
  case
    when cm.order_count <= 0 then null
    when cm.order_count = 1 then 1
    when cm.order_count between 2 and 3 then 2
    else 3
  end as f_score,
  case
    when cm.order_count <= 0 then null
    when cm.revenue_sum < 500 then 1
    when cm.revenue_sum <= 1500 then 2
    else 3
  end as m_score,
  case
    when cm.order_count <= 0 or cm.last_order_at is null then 'no_orders'
    when now() - cm.last_order_at::timestamptz > interval '90 days' then 'at_risk'
    when now() - cm.last_order_at::timestamptz < interval '30 days'
      and cm.order_count >= 4
      and cm.revenue_sum > 1500 then 'champion'
    when now() - cm.last_order_at::timestamptz <= interval '90 days'
      and cm.order_count >= 2 then 'loyal'
    when cm.order_count = 1
      and now() - cm.last_order_at::timestamptz < interval '30 days' then 'new'
    else 'standard'
  end as segment,
  -- value_tier — sub-split of segment='champion' only (Tech Lead spec):
  --   'high' = champion AND revenue_sum > 5000 THB (VIP)
  --   'core' = champion, revenue_sum <= 5000 THB (ordinary champion)
  --   null   = not a champion at all (loyal/new/standard/at_risk/no_orders)
  -- The champion predicate below is copied verbatim from the `segment` case
  -- above (recency < 30d, order_count >= 4, revenue_sum > 1500) — kept as a
  -- literal repeat rather than factored into a CTE/subquery so this remains a
  -- pure column-append with zero risk of changing `segment`'s own plan/output.
  case
    when cm.order_count <= 0 or cm.last_order_at is null then null
    when now() - cm.last_order_at::timestamptz < interval '30 days'
      and cm.order_count >= 4
      and cm.revenue_sum > 1500
      and cm.revenue_sum > 5000 then 'high'
    when now() - cm.last_order_at::timestamptz < interval '30 days'
      and cm.order_count >= 4
      and cm.revenue_sum > 1500 then 'core'
    else null
  end as value_tier
from analytics.v_customer_master cm;

-- ============================================================================
-- 2. analytics.v_customer_master — add latest_province_code / latest_province_name
-- ============================================================================
--
-- Every existing column is copied verbatim from 0020_crm_b1_views.sql lines
-- 241-273. Two new columns appended at the end: the province of each
-- customer's most recent order (by order_date desc, tie-broken by id desc),
-- resolved to a real Thai name via dim_geo. A LEFT JOIN LATERAL scoped to
-- `vfo.customer_id = dc.id` is customer-safe on its own (dim_customer.id is
-- already shop-scoped — a customer_id can't belong to another shop's order),
-- matching the existing `fo` subquery's same v_fact_order source.
create or replace view analytics.v_customer_master
  with (security_invoker = true) as
select
  dc.id as customer_id,
  dc.shop_id,
  dc.display_name,
  dc.first_touch_channel_id,
  dc.created_at,
  coalesce(fo.order_count, 0) as order_count,
  coalesce(fo.revenue_sum, 0) as revenue_sum,
  coalesce(fo.profit_sum, 0) as profit_sum,
  fo.first_order_at,
  fo.last_order_at,
  coalesce(idn.identities_count, 0) as identities_count,
  lp.province_code as latest_province_code,
  case
    when lp.province_code is null or lp.province_code = 'TH-XX' or coalesce(dg.is_unknown, false) then 'ไม่ระบุ'
    else dg.province_name_th
  end as latest_province_name
from analytics.dim_customer dc
left join (
  select
    v.customer_id,
    count(*) as order_count,
    sum(v.revenue) as revenue_sum,
    sum(v.profit) as profit_sum,
    min(v.order_date) as first_order_at,
    max(v.order_date) as last_order_at
  from analytics.v_fact_order v
  where v.customer_id is not null
  group by v.customer_id
) fo on fo.customer_id = dc.id
left join (
  select ci.customer_id, count(*) as identities_count
  from analytics.dim_customer_identity ci
  group by ci.customer_id
) idn on idn.customer_id = dc.id
left join lateral (
  select vfo.province_code
  from analytics.v_fact_order vfo
  where vfo.customer_id = dc.id
  order by vfo.order_date desc, vfo.id desc
  limit 1
) lp on true
left join analytics.dim_geo dg on dg.province_code = lp.province_code
where dc.merged_into_id is null;

-- ============================================================================
-- 3. Grants — re-run per 0020's own note (a fresh `create or replace view`
-- doesn't need this since the relation already exists and was already
-- granted, but this keeps the file self-contained/idempotent the same way
-- every prior views migration does).
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;
