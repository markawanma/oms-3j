-- 0054_dashboard_range_channel_filter.sql
-- /dashboard filter refresh: replace the 3-way period toggle (วันนี้/7วัน/
-- เดือนนี้) with a real date-range + channel filter, matching /crm/overview's
-- pattern (crm_overview_summary, migration 0043/0044). Both dashboard RPCs
-- (dashboard_summary, dashboard_charts) are re-created with a NEW signature:
--   (p_shop_id uuid, p_from date, p_to date, p_channel text default null,
--    p_include_money boolean default true)
-- replacing p_period text. The old (uuid, text, boolean) overloads are
-- explicitly DROPPED (not just superseded) — CREATE OR REPLACE with a
-- different parameter list creates a NEW overload rather than replacing the
-- old one, and leaving both around invites PostgREST/callers to hit the
-- stale period-based function by accident. Decision: drop first (Tech Lead
-- to review before apply).
--
-- Scoping rules (see docs — CMO/architect handoff, applied verbatim):
--   * order window: order_date BETWEEN p_from AND p_to (inclusive both ends).
--   * channel: p_channel is a dim_channel.code; resolved ONCE to a channel id
--     (v_channel_id) — null p_channel (or a code that matches no channel, a
--     graceful no-op consistent with the action layer validating the code
--     against scope.channels before ever calling this RPC — see
--     lib/actions/dashboard.ts) means "every channel", never zero rows.
--   * dashboard_summary: kpi is [from,to]+channel scoped; action/reco/rfm/
--     top_channel stay UNSCOPED (realtime queue / all-time state / fixed
--     this-month leaderboard, unchanged from 0044/0039); repeat_rate's base
--     set (customers-in-scope) is [from,to]+channel scoped but its lateral
--     `cnt` still counts LIFETIME orders across ALL channels (unchanged
--     logic from 0044) — a customer's repeat-buyer status is a lifetime
--     property, not a channel-scoped one.
--   * dashboard_summary gains `scope` (min/max order_date all-time + every
--     channel this shop has ever sold on + the validated/effective
--     from/to/channel actually applied) — feeds the filter UI (date bounds +
--     channel chips), itself NOT scoped to [from,to]/channel (chips must
--     never disappear just because the current window/channel has no
--     orders for a channel).
--   * dashboard_charts: `ord` (and everything derived from it — top_sku,
--     product_mix, aov_by_channel, new_returning, weekday) is [from,to]+
--     channel scoped via the same v_channel_id resolution. `sales_trend`
--     changes from a fixed 30-day window to zero-filled daily buckets over
--     [p_from, p_to] (channel-scoped). `litm_range` stays global/unscoped
--     (line-item import-coverage window, not a report window). NEW section
--     `sales_by_channel` (donut source) is [from,to]-scoped ONLY — it
--     deliberately ignores p_channel so the donut can always compare every
--     channel side-by-side even while a single channel is selected
--     elsewhere on the page; it therefore queries v_fact_order directly
--     (not `ord`, which is channel-filtered) joined to dim_channel.
--
-- Money gate (p_include_money=false, i.e. staff role): unchanged contract —
-- money-bearing sections come back null/[] from the RPC itself, never
-- stripped client-side. dashboard_summary.scope and .action are NOT money
-- (dates/channel codes/queue counts) and are always returned in full.

-- ============================================================================
-- (A) analytics.dashboard_charts
-- ============================================================================

drop function if exists analytics.dashboard_charts(uuid, text, boolean);

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
  itm as (   -- line-items in scope + category bucket + line revenue
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
  trend as (   -- zero-filled daily buckets over the FULL [p_from,p_to] window (was a
               -- fixed 30-day window pre-0054), channel-scoped via `ord`.
    select coalesce(jsonb_agg(jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'),
             'revenue', case when p_include_money then coalesce(r.revenue, 0) end,
             'orders', coalesce(r.orders, 0),
             'aov', case when p_include_money then case when coalesce(r.orders, 0) > 0 then round(r.revenue / r.orders, 2) else 0 end end)
             order by d), '[]') j
    from generate_series(p_from, p_to, interval '1 day') g(d)
    left join ( select order_date, sum(revenue) revenue, count(*) orders
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
    'sales_by_channel', case when p_include_money then (select j from sbc)     else '[]'::jsonb end
  );
$$;

-- service_role only: the app calls this exclusively via the service-role
-- client (lib/actions/dashboard.ts). NOT granted to `authenticated` — the
-- money gate is a caller-supplied p_include_money (default true), so an
-- authenticated caller hitting PostgREST directly could pass true and bypass
-- the app-layer role check (unchanged reasoning from 0044/0052).
revoke execute on function analytics.dashboard_charts(uuid, date, date, text, boolean) from public, authenticated;
grant execute on function analytics.dashboard_charts(uuid, date, date, text, boolean) to service_role;

-- ============================================================================
-- (B) analytics.dashboard_summary
-- ============================================================================

drop function if exists analytics.dashboard_summary(uuid, text, boolean);

create or replace function analytics.dashboard_summary(
  p_shop_id uuid,
  p_from date,
  p_to date,
  p_channel text default null,
  p_include_money boolean default true
)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to 'analytics', 'public', 'pg_temp'
as $$
declare
  v_channel_id uuid;
  v_min_date date;
  v_max_date date;
  v_channels jsonb;
  v_scope jsonb;
  v_kpi jsonb := null;
  v_action jsonb;
  v_reco jsonb := '[]'::jsonb;
  v_rfm jsonb := '{}'::jsonb;
  v_channel jsonb := null;
begin
  v_channel_id := case when p_channel is null then null
                        else (select id from analytics.dim_channel where code = p_channel) end;

  -- scope: all-time min/max order_date + every channel this shop has ever
  -- sold on (NOT scoped to p_from/p_to/p_channel) — feeds the filter UI
  -- (date-input bounds + channel chips) so chips never disappear just
  -- because the currently-selected window/channel has zero orders.
  select min(order_date), max(order_date) into v_min_date, v_max_date
  from analytics.v_fact_order where shop_id = p_shop_id;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name) order by name), '[]'::jsonb)
    into v_channels
  from ( select distinct dch.code, dch.name
         from analytics.v_fact_order v
         join analytics.dim_channel dch on dch.id = v.channel_id
         where v.shop_id = p_shop_id ) t;

  v_scope := jsonb_build_object(
    'min_order_date', to_char(v_min_date, 'YYYY-MM-DD'),
    'max_order_date', to_char(v_max_date, 'YYYY-MM-DD'),
    'channels', v_channels,
    'requested_from', to_char(p_from, 'YYYY-MM-DD'),
    'requested_to', to_char(p_to, 'YYYY-MM-DD'),
    'requested_channel', p_channel
  );

  -- action-needed (always shown, incl. staff; not scoped — outstanding queue is realtime)
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
                    where shop_id = p_shop_id and order_date between p_from and p_to and customer_id is not null
                      and (v_channel_id is null or channel_id = v_channel_id)),
      -- Repeat Rate: base set = customers active in [p_from,p_to]+channel;
      -- `cnt` (lateral) still counts LIFETIME orders across ALL channels
      -- (unchanged from 0044) — repeat-buyer status is a lifetime property,
      -- not something that resets per channel/window. UI label must keep
      -- reading "ลูกค้าช่วงนี้ที่เป็นขาประจำ", not "ซื้อซ้ำในช่วงนี้".
      'repeat_rate', (select case when count(*) > 0
                        then round(count(*) filter (where lt.cnt >= 2)::numeric / count(*), 4)
                        else 0 end
                      from (
                        select distinct customer_id from analytics.v_fact_order
                        where shop_id = p_shop_id and order_date between p_from and p_to and customer_id is not null
                          and (v_channel_id is null or channel_id = v_channel_id)
                      ) c
                      join lateral (
                        select count(*) cnt from analytics.v_fact_order f
                        where f.customer_id = c.customer_id and f.shop_id = p_shop_id
                      ) lt on true)
    ) into v_kpi
    from analytics.v_fact_order
    where shop_id = p_shop_id and order_date between p_from and p_to
      and (v_channel_id is null or channel_id = v_channel_id);

    -- reco/rfm/top_channel: unchanged, NOT scoped to [from,to]/channel — all
    -- represent current/all-time state (reco rules, RFM segments as-of-today,
    -- this-month channel leaderboard), same as 0044/0039.
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
    'scope', v_scope,
    'kpi', v_kpi,
    'action', v_action,
    'reco', v_reco,
    'rfm', v_rfm,
    'top_channel', v_channel
  );
end;
$$;

-- service_role only (same reasoning as dashboard_charts above; supersedes
-- 0044's `to service_role` grant on the old (uuid, text, boolean) signature,
-- which is dropped above).
revoke execute on function analytics.dashboard_summary(uuid, date, date, text, boolean) from public, authenticated;
grant execute on function analytics.dashboard_summary(uuid, date, date, text, boolean) to service_role;

notify pgrst, 'reload schema';
