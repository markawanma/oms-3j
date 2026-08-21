-- 0070_tiktok_dashboard_meta.sql
-- Adds a `meta` key to analytics.tiktok_daily_dashboard's json payload —
-- none of the existing keys are touched.
--
-- Why: the KPI card's "vs เมื่อวาน" delta compares p_date against p_date-1
-- as two full calendar days (0051's v_prev logic, unchanged here). But this
-- app has no live order stream — every order lands via a monthly file
-- import (see lib/actions/*import*), and that file is typically exported
-- mid-day while the shop's TikTok live runs 20:00-23:00 (see
-- docs 3j-jewelry/analytics "Live Selling Rhythm"). So "today" in the data
-- is routinely a partial day — cut off at whatever time the file was
-- exported, not midnight — and comparing a half day against a full
-- yesterday produces a dishonest swing like "-93%" that reads as a crash
-- but is really just "the file hasn't been imported yet". `meta` hands the
-- UI the raw timestamps it needs to tell that story honestly:
--   - data_through: how far ALL imported data (every day, every channel)
--     reaches — the shop-wide import horizon, independent of p_date.
--   - last_order_at: the last order timestamp within p_date specifically,
--     so the UI can show "ข้อมูลถึง 15:29 น." next to a partial day.
--   - min_order_date / max_order_date: the shop's full imported date
--     range, for the date picker to bound its selectable days.
--
-- Deliberately NOT decided here: whether a given day counts as "complete
-- enough" to trust its delta. That's a product policy threshold (e.g. "cut
-- off before 18:00 = flag as partial") that will get tuned by look-and-feel,
-- not by schema — encoding it in SQL would mean a migration every time
-- the threshold changes. This function only returns the raw facts;
-- lib/actions/tiktok-dashboard.ts (TypeScript) decides what "complete"
-- means and renders accordingly.
--
-- order_created_at lives on analytics.stg_order_import (the import staging
-- row), not on analytics.fact_order — joined via
-- stg_order_import.fact_order_id = fact_order.id (indexed:
-- idx_stg_order_import_fact_order_id, see 0011). Not every fact_order row is
-- guaranteed to have a staging row with fact_order_id pointing back to it
-- (fact_order_id is set at transform time and stg rows can in principle be
-- pruned/missing) — when the join finds nothing, every meta field involving
-- order_created_at is null. That's a real "we don't know", not an error and
-- not a guess, so it's returned as sql null rather than defaulted to
-- anything.
--
-- security invoker / stable / search_path / grants: unchanged from 0051 —
-- see that file's header for the full rationale. Same service_role-only
-- caller (lib/actions/tiktok-dashboard.ts).

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
    -- cleanly with no special-casing on the client. meta is all-null: there
    -- is nothing imported to report a horizon for.
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
      ),
      'meta', json_build_object(
        'data_through', null,
        'last_order_at', null,
        'min_order_date', null,
        'max_order_date', null
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
    ),
    -- meta CTEs: shop-wide date range comes straight off fact_order (no
    -- staging join needed). data_through / last_order_at need the actual
    -- import-time timestamp, which only exists on stg_order_import — one
    -- join, one pass, scoped to this shop via fact_order.shop_id (today/prev
    -- above are already date-scoped, so this is a separate shop-wide CTE).
    shop_date_range as (
      select min(order_date) as min_order_date, max(order_date) as max_order_date
      from analytics.fact_order
      where shop_id = p_shop_id
    ),
    staged_created_at as (
      select fo.order_date, soi.order_created_at
      from analytics.stg_order_import soi
      join analytics.fact_order fo on fo.id = soi.fact_order_id
      where fo.shop_id = p_shop_id
    ),
    meta_created_at as (
      select
        max(order_created_at) as data_through,
        max(order_created_at) filter (where order_date = v_date) as last_order_at
      from staged_created_at
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
      ),
      'meta', json_build_object(
        'data_through', mca.data_through,
        'last_order_at', mca.last_order_at,
        'min_order_date', to_char(sdr.min_order_date, 'YYYY-MM-DD'),
        'max_order_date', to_char(sdr.max_order_date, 'YYYY-MM-DD')
      )
    )
    from kpi_today kt, kpi_prev kp, shop_date_range sdr, meta_created_at mca
  );
end;
$$;

-- service_role only: called exclusively via the service-role client
-- (lib/actions/tiktok-dashboard.ts), same reasoning as 0044/0051's grants —
-- no authenticated/anon caller exists for this app yet.
revoke execute on function analytics.tiktok_daily_dashboard(uuid, date) from public, anon, authenticated;
grant execute on function analytics.tiktok_daily_dashboard(uuid, date) to service_role;

notify pgrst, 'reload schema';
