-- 0052_dashboard_weekday_period_scoped.sql
-- The "รูปแบบรายวันในสัปดาห์" (Sales by Weekday) chart on /dashboard was the one
-- section of analytics.dashboard_charts that ignored the period toggle: its `wk`
-- CTE joined analytics.v_fact_order with NO date bound, so it always showed the
-- all-time weekday pattern regardless of วันนี้ / 7 วัน / เดือนนี้ (0044 design
-- §1a deliberately left it all-time). Owner asked for it to follow the selected
-- range like every other chart.
--
-- Fix: compute `wk` from the already period-scoped `ord` CTE (the same rows every
-- other section aggregates — order_date >= bounds.p_from) instead of re-scanning
-- v_fact_order all-time. Only the `wk` CTE changes; the rest of the function is
-- byte-identical to 0044. `security invoker` / `stable` / grants unchanged (this
-- is create-or-replace of the same signature; 0044's grant persists, but we
-- re-assert service_role-only at the bottom to keep the file self-contained).
--
-- Behaviour note (accepted): for period='today' the chart naturally collapses to
-- a single weekday bar, and '7d' shows one day per weekday — the pattern is only
-- rich over 'เดือนนี้'. That is the literal meaning of "ตามช่วงที่เลือก" and is
-- what the owner asked for; the UI subtitle is updated to say so.

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
  wk as (   -- period-scoped: aggregate the same `ord` rows every other section
            -- uses (order_date >= bounds.p_from), so the weekday pattern follows
            -- the วันนี้/7 วัน/เดือนนี้ toggle instead of showing all-time.
    select coalesce(jsonb_agg(jsonb_build_object('dow', dow,
             'label', (array['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'])[dow + 1],
             'orders', orders, 'revenue', case when p_include_money then revenue end) order by dow), '[]') j
    from ( select g.dow, coalesce(count(o.id), 0) orders, coalesce(sum(o.revenue), 0) revenue
           from generate_series(0, 6) g(dow)
           left join ord o on extract(dow from o.order_date)::int = g.dow
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

revoke execute on function analytics.dashboard_charts(uuid, text, boolean) from public, authenticated;
grant execute on function analytics.dashboard_charts(uuid, text, boolean) to service_role;

notify pgrst, 'reload schema';
