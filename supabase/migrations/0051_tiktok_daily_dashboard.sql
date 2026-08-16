-- 0051_tiktok_daily_dashboard.sql
-- Swaps the TikTok Ops "Daily Dashboard" (/tiktok/dashboard) off its fixture
-- (lib/tiktok/mock-actions.ts) onto real data, per design §5 "สลับไฟล์เดียว
-- UI ไม่แก้". This is an ALL-CHANNEL, single-calendar-day snapshot (TikTok +
-- Shopee + LINE mixed) sourced from analytics.fact_order — NOT scoped to
-- TikTok orders only, despite the page's name (design confirmed).
--
-- One RPC, one round trip: analytics.tiktok_daily_dashboard(p_shop_id, p_date)
-- returns the exact json shape lib/actions/tiktok-dashboard.ts expects,
-- mirroring 0044_dashboard_charts.sql's json-returning / service_role-only
-- pattern (single CTE pass per source table, no fetch-loop).
--
-- p_date defaults to the shop's latest imported order_date ("today" from the
-- data's point of view, since this app has no live order stream yet — every
-- order lands via monthly file import, see lib/actions/*import*). "vs เมื่อ
-- วาน" compares against the calendar day immediately before p_date, NOT the
-- previous day that actually has data — an intentional, honest choice: if
-- yesterday has zero imported orders, the KPI delta should read as a real
-- 100% drop, not silently skip to an older comparison day and hide the gap.
--
-- security invoker (matching 0039/0043/0044) — called exclusively via the
-- service-role client (lib/actions/tiktok-dashboard.ts), which bypasses RLS
-- anyway, so definer would add zero capability but an extra privilege-
-- escalation footgun. execute is revoked from public/authenticated and
-- granted to service_role only (see bottom). `stable` because the body is
-- pure reads; search_path is still pinned per best practice. Ordering/keys
-- follow the repo convention ('analytics','public','pg_temp').

create or replace function analytics.tiktok_daily_dashboard(
  p_shop_id uuid,
  p_date date default null
)
 returns json
 language plpgsql
 stable
 security invoker
 set search_path = 'analytics', 'public', 'pg_temp'
as $$
declare
  v_date date;
  v_prev date;
begin
  v_date := coalesce(p_date, (select max(order_date) from analytics.fact_order where shop_id = p_shop_id));

  if v_date is null then
    -- No orders at all for this shop yet — return a well-formed empty
    -- payload instead of erroring, so the UI's existing empty-day branch
    -- (DashboardPageClient: `data.kpis.orderCount.value === 0`) renders
    -- cleanly with no special-casing on the client.
    return json_build_object(
      'date', null,
      'has_data', false,
      'kpis', json_build_object(
        'sales', json_build_object('value', 0, 'prev', 0),
        'orders', json_build_object('value', 0, 'prev', 0),
        'profit', json_build_object('value', 0, 'prev', 0, 'coverage_pct', 0),
        'aov', json_build_object('value', 0, 'prev', 0)
      ),
      'data_quality', json_build_object(
        'cost_coverage_pct', 0,
        'province_unknown_pct', 0,
        'address_pending_review_count', 0
      ),
      'breakdown', json_build_object(
        'channel', '[]'::json,
        'province', '[]'::json,
        'top_products', '[]'::json
      )
    );
  end if;

  v_prev := v_date - 1;

  return (
    with today as (
      select * from analytics.fact_order where shop_id = p_shop_id and order_date = v_date
    ),
    prev as (
      select * from analytics.fact_order where shop_id = p_shop_id and order_date = v_prev
    ),
    kpi_today as (
      select
        coalesce(sum(revenue), 0) as sales,
        count(*) as orders,
        coalesce(sum(profit), 0) as profit,
        case when count(*) > 0 then round(sum(revenue) / count(*)) else 0 end as aov,
        case when count(*) > 0
          then round(100.0 * count(*) filter (where profit_status = 'actual') / count(*), 1)
          else 0
        end as cost_coverage_pct,
        case when count(*) > 0
          then round(100.0 * count(*) filter (where province_code = 'TH-XX' or province_code is null) / count(*), 1)
          else 0
        end as province_unknown_pct
      from today
    ),
    kpi_prev as (
      select
        coalesce(sum(revenue), 0) as sales,
        count(*) as orders,
        coalesce(sum(profit), 0) as profit,
        case when count(*) > 0 then round(sum(revenue) / count(*)) else 0 end as aov
      from prev
    ),
    channel as (
      select coalesce(json_agg(row_to_json(c) order by c.sales desc), '[]'::json) as j
      from (
        select
          label,
          sales,
          orders,
          case when total_sales > 0 then round(100.0 * sales / total_sales) else 0 end as share_pct
        from (
          select
            dch.name as label,
            sum(t.revenue) as sales,
            count(*) as orders,
            sum(sum(t.revenue)) over () as total_sales
          from today t
          join analytics.dim_channel dch on dch.id = t.channel_id
          group by dch.name
        ) g
      ) c
    ),
    province_ranked as (
      select
        coalesce(dg.province_name_th, 'ไม่ระบุ') as label,
        count(*) as orders,
        bool_or(t.province_code = 'TH-XX' or t.province_code is null or coalesce(dg.is_unknown, false)) as is_unknown
      from today t
      left join analytics.dim_geo dg on dg.province_code = t.province_code
      group by coalesce(dg.province_name_th, 'ไม่ระบุ')
    ),
    province as (
      -- Rank purely by order count (NOT is_unknown-last): when "ไม่ระบุ"
      -- dominates (real data has ~87% unknown province), pushing it past a
      -- limit 6 of tiny known provinces would hide the single biggest bucket
      -- and make e.g. Bangkok's 8 orders look like the top province. Honest
      -- ranking surfaces the unknown bar at its true size; the isUnknown flag
      -- still greys it and DataQualityBanner restates the % above the fold.
      select coalesce(json_agg(row_to_json(p)), '[]'::json) as j
      from (
        select label, orders, is_unknown
        from province_ranked
        order by orders desc
        limit 6
      ) p
    ),
    top_products as (
      select coalesce(json_agg(row_to_json(tp)), '[]'::json) as j
      from (
        select
          coalesce(fi.product_name_snapshot, fi.sku_snapshot, 'ไม่ระบุสินค้า') as label,
          sum(fi.qty) as qty
        from analytics.fact_order_item fi
        join today t on t.id = fi.fact_order_id
        group by coalesce(fi.product_name_snapshot, fi.sku_snapshot, 'ไม่ระบุสินค้า')
        order by sum(fi.qty) desc
        limit 5
      ) tp
    )
    select json_build_object(
      'date', to_char(v_date, 'YYYY-MM-DD'),
      'has_data', true,
      'kpis', json_build_object(
        'sales', json_build_object('value', kt.sales, 'prev', kp.sales),
        'orders', json_build_object('value', kt.orders, 'prev', kp.orders),
        'profit', json_build_object('value', kt.profit, 'prev', kp.profit, 'coverage_pct', kt.cost_coverage_pct),
        'aov', json_build_object('value', kt.aov, 'prev', kp.aov)
      ),
      'data_quality', json_build_object(
        'cost_coverage_pct', kt.cost_coverage_pct,
        'province_unknown_pct', kt.province_unknown_pct,
        'address_pending_review_count', 0
      ),
      'breakdown', json_build_object(
        'channel', (select j from channel),
        'province', (select j from province),
        'top_products', (select j from top_products)
      )
    )
    from kpi_today kt, kpi_prev kp
  );
end;
$$;

-- service_role only: called exclusively via the service-role client
-- (lib/actions/tiktok-dashboard.ts), same reasoning as 0044's grants —
-- no authenticated/anon caller exists for this app yet.
revoke execute on function analytics.tiktok_daily_dashboard(uuid, date) from public, authenticated;
grant execute on function analytics.tiktok_daily_dashboard(uuid, date) to service_role;

notify pgrst, 'reload schema';
