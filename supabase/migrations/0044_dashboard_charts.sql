-- 0044_dashboard_charts.sql
-- Phase 1 (backend) of the /dashboard chart refresh
-- (docs/3j-jewelry/analytics/phase-dashboard-charts-design.md, architect).
--
-- Two parts:
--   (A) NEW analytics.dashboard_charts(shop_id, period, include_money) — single
--       jsonb-returning aggregate RPC feeding 6 chart sections (top_sku,
--       product_mix, aov_by_channel, new_returning, sales_trend, weekday) +
--       a coverage block, mirroring 0043's pattern (language sql, stable,
--       security invoker, one CTE pass per source, no fetch-loop — same
--       1000-row-cap lesson 0043 fixed for /crm/overview).
--   (B) create-or-replace analytics.dashboard_summary (0039) — additive only:
--       adds 'customers' and 'repeat_rate' into the existing v_kpi object.
--       Every other field/branch is byte-identical to 0039 so the existing
--       page/action (getDashboard) does not regress.
--
-- Design correction (verified against live data by Tech Lead, overrides
-- design doc section 3): product.category already carries a clean Thai
-- taxonomy ('เงินแท่ง', 'Art Toy เงิน', 'ทองจีน', 'น้ำยาล้างเงิน',
-- 'กล่อง/บรรจุภัณฑ์', ...) and real SKUs use hyphenated prefixes
-- (B-0, P-k, R-D, E-k, BL-), NOT the design doc's `^(NC|BL|B|E|P|R)[0-9]`
-- regex — that regex matches almost nothing and dumps ~everything into
-- 'other'. Bucketing below uses `dp.category` directly. Verified all-time
-- split (every imported line-item): silver_bar 90.8% / jewelry 7.7% /
-- art_toy 1.4% / other 0.1%. The mix shifts by period — bars are lumpy
-- big-ticket, so a 2-week window can read ~34% bar / 65% jewelry; both are
-- correct for their scope.

-- ============================================================================
-- (A) analytics.dashboard_charts
-- ============================================================================

create or replace function analytics.dashboard_charts(
  p_shop_id uuid,
  p_period text default 'month',
  p_include_money boolean default true
)
 returns jsonb
 language sql
 stable
 security invoker
 set search_path to 'analytics', 'public', 'pg_temp'
as $$
  with bounds as (
    select case p_period
      when 'today' then current_date
      when '7d' then current_date - 6
      else date_trunc('month', current_date)::date
    end as p_from
  ),
  ord as (   -- orders in period + has-line-item flag
    select v.id, v.customer_id, v.channel_id, v.order_date, v.revenue, v.is_new_customer,
           exists (select 1 from analytics.fact_order_item fi where fi.fact_order_id = v.id) as has_items
    from analytics.v_fact_order v, bounds b
    where v.shop_id = p_shop_id and v.order_date >= b.p_from
  ),
  itm as (   -- line-items in period + category bucket + line revenue
    select fi.fact_order_id, fi.sku_snapshot, fi.qty, (fi.qty * fi.unit_price)::numeric(14, 2) as line_rev,
           coalesce(dp.name, fi.product_name_snapshot, fi.sku_snapshot) as name,
           case
             when dp.category = 'เงินแท่ง'                                   then 'silver_bar'
             when dp.category = 'Art Toy เงิน'                               then 'art_toy'
             when dp.category in ('ทองจีน', 'น้ำยาล้างเงิน', 'กล่อง/บรรจุภัณฑ์') then 'other'
             when dp.category is null                                        then 'other'
             else                                                                 'jewelry'
           end as bucket
    from analytics.fact_order_item fi
    join ord o on o.id = fi.fact_order_id
    left join analytics.v_dim_product dp on dp.product_id = fi.product_id
  ),
  cov as (
    select count(*) orders_total, count(*) filter (where has_items) orders_with_items from ord
  ),
  litm_range as (   -- global line-item data-availability window (NOT period-scoped):
    -- the min/max order_date that actually has line-items imported, so the
    -- coverage note can honestly say "product data covers <from>–<to>" and
    -- explain why a recent period's coverage % is < 100 (line-items lag the
    -- order-level import). Returns null/null when nothing is imported yet.
    select min(fo.order_date) as lo, max(fo.order_date) as hi
    from analytics.fact_order_item fi
    join analytics.fact_order fo on fo.id = fi.fact_order_id
    where fo.shop_id = p_shop_id
  ),
  top_sku as (
    select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'name', name, 'revenue', revenue, 'qty', qty) order by revenue desc), '[]') j
    from ( select sku_snapshot sku, max(name) name, sum(line_rev) revenue, sum(qty) qty
           from itm group by sku_snapshot order by sum(line_rev) desc limit 10 ) t
  ),
  mix as (
    select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'label', label, 'revenue', revenue,
             'pct', case when tot > 0 then round(revenue / tot, 4) else 0 end) order by revenue desc), '[]') j
    from ( select bucket,
             case bucket when 'silver_bar' then 'เงินแท่ง' when 'jewelry' then 'เครื่องเงิน 925'
                         when 'art_toy' then 'Art Toy เงิน' else 'อื่นๆ' end label,
             sum(line_rev) revenue, sum(sum(line_rev)) over () tot
           from itm group by bucket ) t
  ),
  aov_ch as (
    select coalesce(jsonb_agg(jsonb_build_object('channel_code', code, 'channel_name', name, 'orders', orders,
             'revenue', revenue, 'aov', case when orders > 0 then round(revenue / orders, 2) else 0 end) order by revenue desc), '[]') j
    from ( select dch.code, dch.name, count(*) orders, coalesce(sum(o.revenue), 0) revenue
           from ord o join analytics.dim_channel dch on dch.id = o.channel_id group by dch.code, dch.name ) t
  ),
  nr as (
    -- New vs Returning is computed from ORDER HISTORY, not v_fact_order's
    -- is_new_customer flag: that flag is set per-import-batch (every customer
    -- in a monthly file reads as "new"), so any short period showed ~100% new
    -- / 0 returning (verified: Aug → 328 new / 0 returning, while lifetime
    -- repeat_rate was 53%). Here "new" = order whose customer has NO order
    -- before the period start (first-time buyer acquired this period),
    -- "returning" = customer ordered before, "unknown" = PII-masked
    -- (customer_id null). Lifetime-aware, consistent with dashboard_summary's
    -- repeat_rate. Verified Aug: 188 new / 140 returning / 6 unknown.
    select jsonb_build_object(
             'new', count(*) filter (where o.customer_id is not null and not exists(
                      select 1 from analytics.v_fact_order f
                      where f.customer_id = o.customer_id and f.shop_id = p_shop_id and f.order_date < b.p_from)),
             'returning', count(*) filter (where o.customer_id is not null and exists(
                      select 1 from analytics.v_fact_order f
                      where f.customer_id = o.customer_id and f.shop_id = p_shop_id and f.order_date < b.p_from)),
             'unknown', count(*) filter (where o.customer_id is null)) j
    from ord o, bounds b
  ),
  trend as (   -- fixed 30-day window, zero-filled
    select coalesce(jsonb_agg(jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'),
             'revenue', case when p_include_money then coalesce(r.revenue, 0) end,
             'orders', coalesce(r.orders, 0),
             'aov', case when p_include_money then case when coalesce(r.orders, 0) > 0 then round(r.revenue / r.orders, 2) else 0 end end)
             order by d), '[]') j
    from generate_series(current_date - 29, current_date, interval '1 day') g(d)
    left join ( select order_date, sum(revenue) revenue, count(*) orders
                from analytics.v_fact_order where shop_id = p_shop_id and order_date >= current_date - 29
                group by order_date ) r on r.order_date = g.d::date
  ),
  wk as (   -- all-time, 7 dow rows filled
    select coalesce(jsonb_agg(jsonb_build_object('dow', dow,
             'label', (array['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'])[dow + 1],
             'orders', orders, 'revenue', case when p_include_money then revenue end) order by dow), '[]') j
    from ( select g.dow, coalesce(count(v.id), 0) orders, coalesce(sum(v.revenue), 0) revenue
           from generate_series(0, 6) g(dow)
           left join analytics.v_fact_order v on v.shop_id = p_shop_id and extract(dow from v.order_date)::int = g.dow
           group by g.dow ) t
  )
  select jsonb_build_object(
    'period', p_period,
    'coverage', (select jsonb_build_object('orders_total', orders_total, 'orders_with_items', orders_with_items,
                   'items_pct', case when orders_total > 0 then round(orders_with_items::numeric / orders_total, 4) else 0 end,
                   'range_from', (select to_char(lo, 'YYYY-MM-DD') from litm_range),
                   'range_to', (select to_char(hi, 'YYYY-MM-DD') from litm_range)) from cov),
    'top_sku',        case when p_include_money then (select j from top_sku) else '[]'::jsonb end,
    'product_mix',    case when p_include_money then (select j from mix)     else '[]'::jsonb end,
    'aov_by_channel', case when p_include_money then (select j from aov_ch)  else '[]'::jsonb end,
    'new_returning',  (select j from nr),
    'sales_trend',    (select j from trend),
    'weekday',        (select j from wk)
  );
$$;

-- service_role only: the app calls this exclusively via the service-role
-- client (lib/actions/dashboard.ts). NOT granted to `authenticated` — the
-- money gate is a caller-supplied p_include_money (default true), so an
-- authenticated caller hitting PostgREST directly could pass true and bypass
-- the app-layer role check. No authenticated caller exists, so service_role
-- only closes that latent bypass (security audit 0044).
grant execute on function analytics.dashboard_charts(uuid, text, boolean) to service_role;

-- ============================================================================
-- (B) analytics.dashboard_summary — additive: + kpi.customers, + kpi.repeat_rate
--
-- Every field/branch below is unchanged from 0039 except the two new keys
-- inside the p_include_money v_kpi jsonb_build_object (revenue/orders/profit/
-- aov kept verbatim; action/reco/rfm/top_channel blocks kept verbatim; return
-- shape { period, kpi, action, reco, rfm, top_channel } kept verbatim).
--
-- Customers = distinct customer_id among period orders with customer_id not
-- null (PII-masked orders excluded, so this is a floor not exact headcount).
-- Repeat Rate = share of customers active in the period who are LIFETIME
-- repeat buyers (>=2 orders ever), not repeat-within-period — within-period
-- would read ~0% on 'today'/'7d' since few customers reorder same-day/week,
-- which misleads. Trade-off (per design section 2): this is a lifetime
-- property projected onto the period's customer cohort, so the UI label must
-- read "ลูกค้าช่วงนี้ที่เป็นขาประจำ" not "ซื้อซ้ำในช่วงนี้".
-- ============================================================================

create or replace function analytics.dashboard_summary(
  p_shop_id uuid,
  p_period text default 'month',
  p_include_money boolean default true
)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to 'analytics', 'public', 'pg_temp'
as $$
declare
  v_from date;
  v_kpi jsonb := null;
  v_action jsonb;
  v_reco jsonb := '[]'::jsonb;
  v_rfm jsonb := '{}'::jsonb;
  v_channel jsonb := null;
begin
  v_from := case p_period
    when 'today' then current_date
    when '7d' then current_date - 6
    else date_trunc('month', current_date)::date
  end;

  -- action-needed (always shown, incl. staff)
  select jsonb_build_object(
    'oversold', (select count(*) from analytics.v_oversold_hold_queue where shop_id = p_shop_id),
    'oversold_breached', (select count(*) from analytics.v_oversold_hold_queue where shop_id = p_shop_id and hours_held > 48),
    'low_stock', (select count(*) from analytics.v_hero_stock where shop_id = p_shop_id and (is_low or is_out))
  ) into v_action;

  if p_include_money then
    select jsonb_build_object(
      'revenue', coalesce(sum(revenue), 0),
      'orders', count(*),
      'profit', coalesce(sum(profit), 0),
      'aov', case when count(*) > 0 then round(sum(revenue) / count(*), 2) else 0 end,
      'customers', (select count(distinct customer_id) from analytics.v_fact_order
                    where shop_id = p_shop_id and order_date >= v_from and customer_id is not null),
      'repeat_rate', (select case when count(*) > 0
                        then round(count(*) filter (where lt.cnt >= 2)::numeric / count(*), 4)
                        else 0 end
                      from (
                        select distinct customer_id from analytics.v_fact_order
                        where shop_id = p_shop_id and order_date >= v_from and customer_id is not null
                      ) c
                      join lateral (
                        select count(*) cnt from analytics.v_fact_order f
                        where f.customer_id = c.customer_id and f.shop_id = p_shop_id
                      ) lt on true)
    ) into v_kpi
    from analytics.v_fact_order
    where shop_id = p_shop_id and order_date >= v_from;

    select coalesce(jsonb_agg(x order by pr), '[]'::jsonb) into v_reco from (
      select priority as pr,
        jsonb_build_object('title', title, 'severity', severity, 'rule_code', rule_code) as x
      from analytics.v_marketing_reco
      where shop_id = p_shop_id and is_blocked = false
      order by priority asc
      limit 2
    ) t;

    select coalesce(jsonb_object_agg(segment, c), '{}'::jsonb) into v_rfm from (
      select segment, count(*) as c from analytics.v_rfm_segment where shop_id = p_shop_id group by segment
    ) t;

    select to_jsonb(t) into v_channel from (
      select channel_name, revenue, roas
      from analytics.v_channel_perf_roas
      where shop_id = p_shop_id and month = date_trunc('month', current_date)::date
      order by revenue desc nulls last
      limit 1
    ) t;
  end if;

  return jsonb_build_object(
    'period', p_period,
    'kpi', v_kpi,
    'action', v_action,
    'reco', v_reco,
    'rfm', v_rfm,
    'top_channel', v_channel
  );
end;
$$;

-- service_role only (same reasoning as dashboard_charts above; supersedes
-- 0039's `to authenticated, service_role` grant which had the same latent
-- money-gate bypass).
grant execute on function analytics.dashboard_summary(uuid, text, boolean) to service_role;

notify pgrst, 'reload schema';
