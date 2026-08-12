-- 0033_audience_view.sql
-- Marketing feature A — audience list builder for LINE broadcast targeting
-- (docs/3j-jewelry/marketing/campaign-plan-99-winback.md). Combines the RFM
-- segment + customer master + most-recent province into one row per customer,
-- so the owner can pull "champion / loyal / new" lists to plan a broadcast.
--
-- NO raw PII here (display_name only, not phone/address) — a planning/targeting
-- list, security_invoker like every other analytics view. If phone-based LINE
-- upload is ever needed it must go through a separate owner/admin-gated join to
-- pii_customer (same pattern as lib/actions/crm.ts), not this view.

create or replace view analytics.v_audience
  with (security_invoker = true) as
with cust_province as (
  -- each customer's most-recent order province (their "home" for geo targeting)
  select distinct on (v.customer_id)
    v.customer_id,
    v.province_code
  from analytics.v_fact_order v
  where v.customer_id is not null
  order by v.customer_id, v.order_date desc, v.id desc
)
select
  cm.shop_id,
  cm.customer_id,
  cm.display_name,
  rfm.segment,
  cm.order_count,
  cm.revenue_sum,
  rfm.recency_days,
  cm.first_order_at,
  cm.last_order_at,
  dch.code as channel_code,
  dch.name as channel_name,
  cp.province_code,
  g.province_name_th
from analytics.v_customer_master cm
join analytics.v_rfm_segment rfm on rfm.customer_id = cm.customer_id
left join analytics.dim_channel dch on dch.id = cm.first_touch_channel_id
left join cust_province cp on cp.customer_id = cm.customer_id
left join analytics.dim_geo g on g.province_code = cp.province_code;

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
