-- 0119_dashboard_trend_split.sql
-- "แบ่งสีแท่งกราฟยอดขายรายวัน" (เจ้าของขอ 14 ก.ย. 69, design approved by
-- architect). analytics.dashboard_charts gains ONE new top-level key,
-- `trend_split`, that breaks the daily sales_trend bars down three ways
-- (first-vs-repeat order, RFM segment, product bucket) so the /dashboard
-- trend chart can render stacked/split bars instead of a single color.
--
-- Signature is UNCHANGED: (uuid, date, date, text, boolean) — same as 0054/
-- 0108 — so this is a bare `create or replace function`, not a drop+
-- recreate (no overload risk, 3j-migration-traps #1). Body is 0054's body
-- copied verbatim (0108 did not touch this function — only dashboard_summary
-- and v_fact_order — so 0054 remains the correct base to copy from) plus:
--
--   (a) NEW CTE `first_order` — each customer's globally-first order id
--       (lifetime, unscoped by p_from/p_to/channel), computed the SAME way
--       as the 0045/0069 backfill (`distinct on (customer_id) ... order by
--       customer_id, order_date, id`). Per Tech Lead brief: NEVER read
--       fact_order.is_new_customer (per-import-batch flag, has drifted and
--       needed backfilling twice — 0045, 0069) — this recomputes it fresh
--       from order history every call, same as the existing `nr` CTE does
--       for the (differently-scoped) new_returning key.
--   (b) `itm` CTE: added `o.order_date` to the select list (additive column,
--       reusing the SAME category->bucket case expression already in this
--       CTE — no second bucket-classification ruleset introduced).
--   (c) NEW CTEs `split_fr` / `split_rfm` / `split_prod` — per-day breakdown
--       by first/repeat, RFM segment, and product bucket respectively.
--       Deliberately NOT zero-filled (unlike `trend`) — a day with zero
--       orders simply has no rows in these three sets, consistent with
--       "sum over these three sets for a given day == that day's sales_trend
--       entry" (see scripts/verify-0119.sql T-assertions 2/3).
--   (d) `trend` CTE: added `orders_without_items` per day (additive field,
--       NOT money-gated — same treatment as the existing `orders` field —
--       count(*) filter (where not has_items), reusing `ord.has_items`
--       which already exists in this CTE). This is the one field-level
--       change inside an EXISTING top-level key (sales_trend) rather than a
--       purely-additive new key — see verify script header for how that's
--       reconciled with the "8 old keys byte-identical" check.
--   (e) Output: new top-level key `trend_split` = { first_repeat, rfm,
--       product }, each an array of { date, key, orders, revenue } (product:
--       { date, key, value }), revenue null when p_include_money = false
--       (same money-gate pattern as every other money field in this
--       function), product = [] outright when p_include_money = false (same
--       pattern as top_sku/product_mix/aov_by_channel/sales_by_channel).
--
-- Grants: 0054's original revoke on THIS function only listed
-- `public, authenticated` — missing `anon` (Supabase grants EXECUTE to anon
-- separately from public by default; 0108 already closed this same gap on
-- dashboard_summary, this closes it here too). Re-grant is mandatory on
-- every `create or replace function` regardless of signature change (skill
-- supabase-migrate gotcha #1 / 3j-migration-traps #2).
--
-- ⚠️ DO NOT APPLY -- file only. Tech Lead applies via MCP after running
-- scripts/verify-0119.sql (which embeds this DDL and rolls back).

create or replace function analytics.dashboard_charts(
  p_shop_id uuid,
  p_from date,
  p_to date,
  p_channel text default null,
  p_include_money boolean default true
)
 returns jsonb
 language sql
 stable
 security invoker
 set search_path to 'analytics', 'public', 'pg_temp'
as $$
  with scope as (   -- resolve p_channel -> dim_channel.id ONCE; null = every channel
                     -- (including an unmatched code, see header note above)
    select case when p_channel is null then null
                else (select id from analytics.dim_channel where code = p_channel) end as v_channel_id
  ),
  ord as (   -- orders in [p_from,p_to] + channel + has-line-item flag
    select v.id, v.customer_id, v.channel_id, v.order_date, v.revenue, v.is_new_customer,
           exists (select 1 from analytics.fact_order_item fi where fi.fact_order_id = v.id) as has_items
    from analytics.v_fact_order v, scope s
    where v.shop_id = p_shop_id
      and v.order_date between p_from and p_to
      and (s.v_channel_id is null or v.channel_id = s.v_channel_id)
  ),
  first_order as (   -- 0119: each customer's globally-first order id (lifetime,
    -- NOT scoped to p_from/p_to/channel) -- same recompute-from-history
    -- pattern as the 0045/0069 backfill and the `nr` CTE below. Never reads
    -- fact_order.is_new_customer (unreliable per-import-batch flag).
    select distinct on (customer_id) customer_id, id as first_id
    from analytics.v_fact_order
    where shop_id = p_shop_id and customer_id is not null
    order by customer_id, order_date, id
  ),
  itm as (   -- line-items in scope + category bucket + line revenue
             -- 0119: added o.order_date to the select list (additive) for split_prod below.
    select fi.fact_order_id, fi.sku_snapshot, fi.qty, (fi.qty * fi.unit_price)::numeric(14, 2) as line_rev,
           coalesce(dp.name, fi.product_name_snapshot, fi.sku_snapshot) as name,
           case
             when dp.category = 'เงินแท่ง'                                   then 'silver_bar'
             when dp.category = 'Art Toy เงิน'                               then 'art_toy'
             when dp.category in ('ทองจีน', 'น้ำยาล้างเงิน', 'กล่อง/บรรจุภัณฑ์') then 'other'
             when dp.category is null                                        then 'other'
             else                                                                 'jewelry'
           end as bucket,
           o.order_date
    from analytics.fact_order_item fi
    join ord o on o.id = fi.fact_order_id
    left join analytics.v_dim_product dp on dp.product_id = fi.product_id
  ),
  cov as (
    select count(*) orders_total, count(*) filter (where has_items) orders_with_items from ord
  ),
  litm_range as (   -- global line-item data-availability window (NOT scoped):
    -- the min/max order_date that actually has line-items imported, so the
    -- coverage note can honestly say "product data covers <from>–<to>" and
    -- explain why a recent window's coverage % is < 100 (line-items lag the
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
    -- is_new_customer flag (per-import-batch, unreliable — see 0044). "new" =
    -- order whose customer has NO order before p_from (first-time buyer
    -- acquired within [p_from,p_to]), "returning" = customer ordered before
    -- p_from, "unknown" = PII-masked (customer_id null).
    select jsonb_build_object(
             'new', count(*) filter (where o.customer_id is not null and not exists(
                      select 1 from analytics.v_fact_order f
                      where f.customer_id = o.customer_id and f.shop_id = p_shop_id and f.order_date < p_from)),
             'returning', count(*) filter (where o.customer_id is not null and exists(
                      select 1 from analytics.v_fact_order f
                      where f.customer_id = o.customer_id and f.shop_id = p_shop_id and f.order_date < p_from)),
             'unknown', count(*) filter (where o.customer_id is null)) j
    from ord o
  ),
  split_fr as (   -- 0119: per-day first-vs-repeat breakdown. Distinct from `nr`
    -- above on purpose -- `nr` labels by "any order before p_from?" (cohort
    -- acquired in-window), this labels each INDIVIDUAL order by whether it IS
    -- that customer's one-and-only globally-first order (`first_order`
    -- above). A customer can contribute a 'first' row once ever and 'repeat'
    -- rows for every other order, including ones inside the same window.
    select o.order_date,
           case when o.customer_id is null then 'unknown'
                when o.id = f.first_id then 'first' else 'repeat' end as key,
           count(*) as orders, sum(o.revenue) as revenue
    from ord o left join first_order f using (customer_id) group by 1, 2
  ),
  split_rfm as (   -- 0119: per-day RFM-segment breakdown, same segment source
    -- (analytics.v_rfm_segment, current-as-of-today) already used elsewhere
    -- (dashboard_summary's `rfm` key). 'unknown' covers both PII-masked
    -- orders (customer_id null) and the (should-not-happen) no-match case.
    select o.order_date, coalesce(s.segment, 'unknown') as key,
           count(*) as orders, sum(o.revenue) as revenue
    from ord o left join analytics.v_rfm_segment s
           on s.customer_id = o.customer_id and s.shop_id = p_shop_id
    group by 1, 2
  ),
  split_prod as (   -- 0119: per-day product-bucket breakdown, reusing `itm`'s
    -- bucket classification verbatim (same 4 buckets as product_mix above).
    select i.order_date, i.bucket as key, sum(i.line_rev) as value from itm i group by 1, 2
  ),
  trend as (   -- zero-filled daily buckets over the FULL [p_from,p_to] window (was a
               -- fixed 30-day window pre-0054), channel-scoped via `ord`.
               -- 0119: added `orders_without_items` per day (additive field,
               -- NOT money-gated, same treatment as `orders` -- reuses
               -- `ord.has_items` which already exists in this CTE).
    select coalesce(jsonb_agg(jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'),
             'revenue', case when p_include_money then coalesce(r.revenue, 0) end,
             'orders', coalesce(r.orders, 0),
             'orders_without_items', coalesce(r.orders_without_items, 0),
             'aov', case when p_include_money then case when coalesce(r.orders, 0) > 0 then round(r.revenue / r.orders, 2) else 0 end end)
             order by d), '[]') j
    from generate_series(p_from, p_to, interval '1 day') g(d)
    left join ( select order_date, sum(revenue) revenue, count(*) orders,
                       count(*) filter (where not has_items) orders_without_items
                from ord group by order_date ) r on r.order_date = g.d::date
  ),
  wk as (   -- scoped: aggregate the same `ord` rows every other section uses
            -- (0052's fix, carried forward under [from,to]+channel scoping).
    select coalesce(jsonb_agg(jsonb_build_object('dow', dow,
             'label', (array['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'])[dow + 1],
             'orders', orders, 'revenue', case when p_include_money then revenue end) order by dow), '[]') j
    from ( select g.dow, coalesce(count(o.id), 0) orders, coalesce(sum(o.revenue), 0) revenue
           from generate_series(0, 6) g(dow)
           left join ord o on extract(dow from o.order_date)::int = g.dow
           group by g.dow ) t
  ),
  chan_all as (   -- sales_by_channel source set: [from,to]-scoped ONLY, deliberately
                   -- NOT channel-filtered (the donut must always compare every channel,
                   -- even while a single channel is selected elsewhere on the page) —
                   -- so this queries v_fact_order directly, not `ord`.
    select v.id, v.revenue, v.channel_id
    from analytics.v_fact_order v
    where v.shop_id = p_shop_id and v.order_date between p_from and p_to
  ),
  sbc as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'channel_code', code, 'channel_name', name, 'revenue', revenue, 'orders', orders,
             'share_pct', case when tot > 0 then round(100 * revenue / tot, 2) else 0 end
           ) order by revenue desc), '[]') j
    from ( select dch.code, dch.name, coalesce(sum(c.revenue), 0) revenue, count(c.id) orders,
                  sum(coalesce(sum(c.revenue), 0)) over () tot
           from chan_all c join analytics.dim_channel dch on dch.id = c.channel_id
           group by dch.code, dch.name ) t
  )
  select jsonb_build_object(
    'coverage', (select jsonb_build_object('orders_total', orders_total, 'orders_with_items', orders_with_items,
                   'items_pct', case when orders_total > 0 then round(orders_with_items::numeric / orders_total, 4) else 0 end,
                   'range_from', (select to_char(lo, 'YYYY-MM-DD') from litm_range),
                   'range_to', (select to_char(hi, 'YYYY-MM-DD') from litm_range)) from cov),
    'top_sku',          case when p_include_money then (select j from top_sku) else '[]'::jsonb end,
    'product_mix',      case when p_include_money then (select j from mix)     else '[]'::jsonb end,
    'aov_by_channel',   case when p_include_money then (select j from aov_ch)  else '[]'::jsonb end,
    'new_returning',    (select j from nr),
    'sales_trend',      (select j from trend),
    'weekday',          (select j from wk),
    'sales_by_channel', case when p_include_money then (select j from sbc)     else '[]'::jsonb end,
    'trend_split', jsonb_build_object(
      'first_repeat', (select coalesce(jsonb_agg(jsonb_build_object(
                         'date', to_char(order_date, 'YYYY-MM-DD'), 'key', key, 'orders', orders,
                         'revenue', case when p_include_money then revenue end)
                         order by order_date, key), '[]') from split_fr),
      'rfm',          (select coalesce(jsonb_agg(jsonb_build_object(
                         'date', to_char(order_date, 'YYYY-MM-DD'), 'key', key, 'orders', orders,
                         'revenue', case when p_include_money then revenue end)
                         order by order_date, key), '[]') from split_rfm),
      'product',      case when p_include_money then
                         (select coalesce(jsonb_agg(jsonb_build_object(
                            'date', to_char(order_date, 'YYYY-MM-DD'), 'key', key, 'value', value)
                            order by order_date, key), '[]') from split_prod)
                       else '[]'::jsonb end
    )
  );
$$;

-- service_role only: the app calls this exclusively via the service-role
-- client (lib/actions/dashboard.ts). NOT granted to `authenticated` or
-- `anon` — the money gate is a caller-supplied p_include_money (default
-- true), so a direct PostgREST caller could pass true and bypass the
-- app-layer role check. 0054's original revoke on this function only listed
-- `public, authenticated` (anon gap) -- closed here, same fix 0108 already
-- applied to dashboard_summary.
revoke execute on function analytics.dashboard_charts(uuid, date, date, text, boolean) from public, anon, authenticated;
grant execute on function analytics.dashboard_charts(uuid, date, date, text, boolean) to service_role;

notify pgrst, 'reload schema';
