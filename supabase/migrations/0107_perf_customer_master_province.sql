-- 0107_perf_customer_master_province.sql
-- ✅ APPLIED 4 ก.ย. 69 (version 20260904084307) — ไฟล์ถูกเก็บเข้า main 14 ก.ย. 69
--    หลังค้างอยู่บน branch feature/dashboard-perf ทำให้ main เคยกระโดด 0106 -> 0110
-- Perf fix (architect-approved design, Tech Lead handoff 2026-09-04):
--
-- analytics.v_customer_master's `lp` LEFT JOIN LATERAL scanned
-- analytics.v_fact_order once PER CUSTOMER just to find each customer's
-- latest-order province (measured: 3,372 correlated executions -> 18,376
-- buffers on shop a7c850ee-6776-4c3e-ba72-ba9e8caba2b7). v_rfm_segment is
-- built directly on top of this view (`from analytics.v_customer_master
-- cm` in 0055) and does NOT use latest_province_code/latest_province_name
-- at all -- but Postgres can't drop an unused LEFT JOIN LATERAL with a
-- LIMIT 1 (it's not a pure functional dependency), so every v_rfm_segment
-- read pays the full lateral cost anyway. dashboard_summary reads
-- v_rfm_segment once per call -- this lateral is the single largest
-- contributor to the measured 279ms / 56,136 buffers on /dashboard.
--
-- Fix: fold the "latest province" lookup into the `fo` aggregate subquery
-- that is ALREADY doing one GROUP BY pass over v_fact_order for
-- order_count/revenue_sum/profit_sum/first_order_at/last_order_at. Adding
-- `array_agg(province_code order by order_date desc, id desc)` to that same
-- pass costs one more aggregate per group, not a second scan of the table --
-- a `distinct on (customer_id) ... order by customer_id, order_date desc,
-- id desc` subquery (the alternative the design doc allows) would instead
-- require its own separate full scan + sort of v_fact_order, joined a
-- second time, which is strictly more work than extending the scan `fo`
-- already performs. Average orders/customer in this shop is ~1.8
-- (6,024 orders / 3,372 customers per the brief), so the ORDER BY inside
-- each array_agg group is cheap -- this is the better of the two options
-- the design doc offered, chosen over distinct-on for that reason.
--
-- Ordering MUST match the replaced lateral exactly -- `order by order_date
-- desc, id desc` (same "most recent order, ties broken by highest id"
-- rule) -- or a customer's displayed province silently changes. A customer
-- with zero orders still gets `fo` = null (no row in the LEFT JOIN), so
-- latest_province_code stays null and the existing case expression still
-- resolves to 'ไม่ระบุ', unchanged from before.
--
-- Column list: copied verbatim from 0055_crm_province_champion_tier.sql
-- (the latest migration that touched this view) -- same 13 columns, same
-- names, same order, same types (`latest_province_code` text,
-- `last_order_at` date, unchanged -- it's still `max(v.order_date)` where
-- v.order_date is a date). ONLY the provenance of latest_province_code
-- changes (from a correlated lateral to an aggregate inside `fo`); every
-- other column and expression is byte-for-byte identical to 0055.
--
-- v_rfm_segment (0055) selects `from analytics.v_customer_master cm` with
-- no column list changes needed on its side -- it already reads
-- cm.order_count / cm.revenue_sum / cm.last_order_at etc. by name, not by
-- position, and doesn't touch latest_province_code/latest_province_name at
-- all, so it is untouched by this file and needs no re-create.
--
-- ⚠️ DO NOT APPLY -- file only. Tech Lead applies via MCP after running
-- scripts/verify-0107-0108.sql (which embeds this DDL and rolls back).

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
  fo.latest_province_code,
  case
    when fo.latest_province_code is null or fo.latest_province_code = 'TH-XX' or coalesce(dg.is_unknown, false) then 'ไม่ระบุ'
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
    max(v.order_date) as last_order_at,
    -- Same "most recent order, ties broken by highest id" rule as the
    -- lateral it replaces (0055) -- computed inside the same GROUP BY pass
    -- this subquery already runs, instead of a second per-customer scan.
    (array_agg(v.province_code order by v.order_date desc, v.id desc))[1] as latest_province_code
  from analytics.v_fact_order v
  where v.customer_id is not null
  group by v.customer_id
) fo on fo.customer_id = dc.id
left join (
  select ci.customer_id, count(*) as identities_count
  from analytics.dim_customer_identity ci
  group by ci.customer_id
) idn on idn.customer_id = dc.id
left join analytics.dim_geo dg on dg.province_code = fo.latest_province_code
where dc.merged_into_id is null;

-- Grants -- defensive/idempotent only: a bare `create or replace view`
-- (no DROP) preserves existing relation-level grants in Postgres (confirmed
-- in this repo by 0103's header note: "View grants don't survive
-- drop+create, unlike a bare create-or-replace"). Scoped to the one view
-- this file touches -- NOT `grant select on all tables in schema analytics`
-- (skill 3j-migration-traps #7 -- that blanket form already re-exposed
-- analytics.oem_doc_counter twice in this repo's history, see 0103 §2).
grant select on analytics.v_customer_master to authenticated, service_role;

notify pgrst, 'reload schema';
