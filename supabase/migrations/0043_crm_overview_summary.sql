-- 0043_crm_overview_summary.sql
-- Fixes 2 related bugs in /crm/overview's getCrmOverview (lib/actions/crm.ts)
-- and adds the channel filter it was missing, by aggregating in SQL instead
-- of fetching + reducing in JS. Pattern mirrors 0039_dashboard_summary.sql
-- (single jsonb-returning function, security invoker — this app's server
-- actions always call it through the service-role client, which already
-- bypasses RLS; security invoker is correct here for the same reason 0039
-- used it: this is a pure read aggregate, unlike the owner/admin-gated
-- SECURITY DEFINER write RPCs in 0021).
--
-- Bug 1 (CAP): the old code did
--   `.from("v_fact_order").select(...).eq(shop).gte/lte(date)` with NO
-- `.limit()`, so PostgREST's default row cap (1,000) silently truncated
-- totals/segments/channel breakdown once a shop passed 1,000 orders in the
-- requested range (confirmed: Jun+Jul 2026 has ~2,000 orders, UI showed
-- exactly 1,000). Aggregating with COUNT/SUM in SQL removes the row cap
-- entirely — the client never receives per-order rows for this page anymore.
--
-- Bug 2 (stale "estimate" label): v_fact_order.profit is REAL profit
-- (profit_status='actual') for every order transform_pending_order_lines
-- (0041) has processed via a line-item import, and still a 20%-of-revenue
-- guess (profit_status='estimated') for orders that haven't been. The old
-- code summed profit blind to profit_status and the UI hardcoded "ประมาณการ
-- 20%" regardless. This RPC additionally returns profit_actual_orders /
-- profit_estimated_orders (order counts per status) so the UI can render an
-- accurate label ("กำไรจริง X ออเดอร์ + ประมาณการ Y ออเดอร์") instead of
-- claiming the whole sum is a guess. profit itself is still a SUM of mixed
-- actual+estimated rows (same "authoritative number is whatever v_fact_order
-- says today" contract v_customer_master.profit_sum already has) — this
-- migration does not change that contract, only exposes enough for the label
-- to stop lying.
--
-- Bug 3 (no channel filter): p_channel_code (analytics.dim_channel.code)
-- filters every section (totals/channel_perf/segment_counts) when non-null;
-- null (default) means "every channel", matching the page's existing
-- "no filter = all-time/all-channel" contract for date range.

create or replace function analytics.crm_overview_summary(
  p_shop_id uuid,
  p_from date default null,
  p_to date default null,
  p_channel_code text default null
)
 returns jsonb
 language sql
 stable
 security invoker
 set search_path to 'analytics', 'public', 'pg_temp'
as $$
  with filtered as (
    -- One shop/date/channel-scoped pass over v_fact_order, reused by every
    -- section below (totals/channel_perf/segment_counts) instead of hitting
    -- the base view 3x — same "compute once, reuse" reasoning as
    -- getCrmOverview's original single-fetch design, just moved into SQL so
    -- it isn't capped anymore.
    select
      v.customer_id,
      v.revenue,
      v.profit,
      v.profit_status,
      v.order_date,
      v.is_new_customer,
      dch.code as channel_code,
      dch.name as channel_name
    from analytics.v_fact_order v
    join analytics.dim_channel dch on dch.id = v.channel_id
    where v.shop_id = p_shop_id
      and (p_from is null or v.order_date >= p_from)
      and (p_to is null or v.order_date <= p_to)
      and (p_channel_code is null or dch.code = p_channel_code)
  ),
  totals as (
    select jsonb_build_object(
      'orders', count(*),
      'revenue', coalesce(sum(revenue), 0),
      'profit', coalesce(sum(profit), 0),
      'customers', count(distinct customer_id),
      'profit_actual_orders', count(*) filter (where profit_status = 'actual'),
      'profit_estimated_orders', count(*) filter (where profit_status = 'estimated')
    ) as j
    from filtered
  ),
  channel_month as (
    select
      date_trunc('month', order_date)::date as month,
      channel_code,
      channel_name,
      count(*) as orders,
      coalesce(sum(revenue), 0) as revenue,
      case when count(*) > 0 then round(sum(revenue) / count(*), 2) else 0 end as aov,
      count(*) filter (where is_new_customer) as new_customers
    from filtered
    group by date_trunc('month', order_date), channel_code, channel_name
  ),
  channel as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'month', to_char(month, 'YYYY-MM-DD'),
          'channel_code', channel_code,
          'channel_name', channel_name,
          'orders', orders,
          'revenue', revenue,
          'aov', aov,
          'new_customers', new_customers
        )
        order by month desc, channel_code asc
      ),
      '[]'::jsonb
    ) as j
    from channel_month
  ),
  segments as (
    -- Segment VALUE is each customer's current (as-of-today) v_rfm_segment
    -- row, same as the old JS — only membership ("who counts") is scoped to
    -- customers with >=1 order in the filtered range, not recency itself.
    select coalesce(jsonb_object_agg(segment, c), '{}'::jsonb) as j
    from (
      select rs.segment, count(*) as c
      from analytics.v_rfm_segment rs
      where rs.shop_id = p_shop_id
        and rs.customer_id in (select distinct customer_id from filtered where customer_id is not null)
      group by rs.segment
    ) t
  )
  select jsonb_build_object(
    'totals', (select j from totals),
    'channel_perf', (select j from channel),
    'segment_counts', (select j from segments)
  );
$$;

grant execute on function analytics.crm_overview_summary(uuid, date, date, text) to authenticated, service_role;

notify pgrst, 'reload schema';
