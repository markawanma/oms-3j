-- scripts/verify-0120.sql
--
-- Self-contained verify script for supabase/migrations/0120_crm_retention.sql
-- (recency ladder + repeat-purchase cohort). Per skill 3j-migration-traps
-- #11: everything runs inside ONE `do $$ ... $$` block that ALWAYS ends in
-- `raise exception`, so the whole transaction rolls back no matter what --
-- pass or fail. Read the result from the error message this produces, then
-- decide whether to apply 0120 for real via the MCP `apply_migration` tool.
--
-- Shop under test: a7c850ee-6776-4c3e-ba72-ba9e8caba2b7 (same shop every
-- other verify-01xx script in this repo uses).
--
-- What this checks, in order:
--   B0. golden column list for analytics.v_audience BEFORE any DDL runs --
--       must be exactly the 20 columns from 0099, in order. A mismatch here
--       means this file's "copied byte-for-byte from 0099" claim is stale
--       against the live DB and must NOT be applied as-is (3j-migration-traps
--       #3 / 42P16).
--   (applies 0120's DDL verbatim, via EXECUTE on dollar-quoted strings, in
--    file order: Part A -> B -> C -> D)
--   B1. v_audience AFTER DDL has the same 20 columns in the same positions,
--       plus exactly 2 new columns (reachable, recency_bucket) appended.
--   B2. getAudience()'s exact select-list (lib/actions/marketing.ts) still
--       runs without error against the new view.
--   B3. no customer with order_count=0 ever gets recency_bucket='0-7' (or
--       any bucket at all -- structural: recency_days is null whenever
--       order_count=0, since last_order_at is null in v_customer_master).
--   C1. ladder: sum(cells[].customers) = count(v_audience where
--       shop_id=... and order_count>0) -- exact equality, no double count,
--       no dropped customer.
--   C2. ladder money gate: p_include_money=false -> every cell's revenue
--       key is JSON null.
--   D1. cohort: as_of = max(order_date) for the shop (never current_date).
--   D2. cohort: every immature cell (mature=false) has rate=null in w7/w14/w30
--       -- never 0, never a number.
--   D3. cohort: p_weeks outside [1,104] raises (tested at 0 and 105).
--   E1. grants: anon/authenticated execute = false, service_role = true for
--       both new RPCs. v_audience: anon select = false (never granted).
--   E2. exactly 1 pg_proc row for each new RPC (no accidental overload).
--   F1. perf: wall-clock timing for both RPCs (target < 150ms) + best-effort
--       EXPLAIN (ANALYZE, BUFFERS) text captured into the log. NOTE: the SQL-
--       language crm_recency_ladder is eligible for inlining so its EXPLAIN
--       should show real per-scan buffers; crm_repeat_cohort is PL/pgSQL,
--       which Postgres does NOT let a caller's EXPLAIN see inside (a known,
--       documented limitation, not a bug in this script) -- for that
--       function the wall-clock number below is the trustworthy figure,
--       and the EXPLAIN block will likely show only a single opaque
--       "Result" node. Flagged here so whoever reads this output doesn't
--       mistake a thin EXPLAIN for a thin function.
--
-- After this reports all-OK, apply 0120 for real via `apply_migration`, then
-- run `get_advisors(type: "security")` per the supabase-migrate skill.

do $$
declare
  v_shop_id constant uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7';
  v_log text := E'\n=== verify 0120 (crm_recency_ladder + crm_repeat_cohort) ===\n';

  v_cols_before text;
  v_cols_after  text;
  v_cols_expected_before constant text :=
    'shop_id,customer_id,display_name,segment,order_count,revenue_sum,recency_days,' ||
    'first_order_at,last_order_at,channel_code,channel_name,province_code,province_name_th,' ||
    'bought_bar,bought_jewelry,bar_revenue,jewelry_revenue,affinity,bar_order_count,jewelry_order_count';
  v_cols_expected_after constant text :=
    v_cols_expected_before || ',reachable,recency_bucket';

  v_audience_probe_rows int;

  v_bad_zero_bucket int;

  v_ladder jsonb;
  v_ladder_no_money jsonb;
  v_ladder_sum_customers numeric;
  v_customers_with_orders int;
  v_bad_money_leak int;

  v_expected_as_of date;
  v_cohort jsonb;
  v_cohort_as_of date;
  v_bad_immature_rate int;

  v_fn_count_ladder int;
  v_fn_count_cohort int;

  v_priv_anon boolean;
  v_priv_authenticated boolean;
  v_priv_service_role boolean;
  v_priv_anon_audience boolean;

  v_t0 timestamptz;
  v_t1 timestamptz;
  v_ladder_ms numeric;
  v_cohort_ms numeric;
  v_plan_line text;
  v_plan_text text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- B0: golden column list for v_audience BEFORE any DDL
  -----------------------------------------------------------------------
  select string_agg(column_name, ',' order by ordinal_position)
    into v_cols_before
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'v_audience';

  v_log := v_log || format(E'[B0] v_audience columns BEFORE DDL:\n  %s\n', v_cols_before);

  begin
    if v_cols_before is distinct from v_cols_expected_before then
      raise exception 'v_audience column list drifted from 0099 -- expected:\n  %\ngot:\n  %', v_cols_expected_before, v_cols_before;
    end if;
    v_log := v_log || 'B0 golden column list matches 0099: OK' || E'\n';
  exception when others then
    v_log := v_log || 'B0 golden column list matches 0099: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- Apply 0120's DDL verbatim, in this same (rolled-back) transaction.
  -- One statement per EXECUTE, matching verify-0110's own house style.
  -----------------------------------------------------------------------

  -- Part A
  execute $ddlA1$
    alter table analytics.dim_channel
      add column if not exists is_contactable boolean not null default false;
  $ddlA1$;

  execute $ddlA2$
    update analytics.dim_channel
       set is_contactable = true
     where code in ('line_oa', 'facebook');
  $ddlA2$;

  -- Part B
  execute $ddlB1$
    create or replace view analytics.v_audience
      with (security_invoker = true) as
    with cust_province as (
      select distinct on (v.customer_id)
        v.customer_id,
        v.province_code
      from analytics.v_fact_order v
      where v.customer_id is not null
      order by v.customer_id, v.order_date desc, v.id desc
    ),
    reach as (
      select
        fo.customer_id,
        bool_or(dch.is_contactable) as reachable
      from analytics.v_fact_order fo
      join analytics.dim_channel dch on dch.id = fo.channel_id
      where fo.customer_id is not null
      group by fo.customer_id
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
      g.province_name_th,
      coalesce(ca.bought_bar, false) as bought_bar,
      coalesce(ca.bought_jewelry, false) as bought_jewelry,
      coalesce(ca.bar_revenue, 0)::numeric(14, 2) as bar_revenue,
      coalesce(ca.jewelry_revenue, 0)::numeric(14, 2) as jewelry_revenue,
      coalesce(ca.affinity, 'unknown') as affinity,
      coalesce(ca.bar_order_count, 0)::int as bar_order_count,
      coalesce(ca.jewelry_order_count, 0)::int as jewelry_order_count,
      coalesce(rc.reachable, false) as reachable,
      case
        when rfm.recency_days is null then null
        when rfm.recency_days <= 7 then '0-7'
        when rfm.recency_days <= 14 then '8-14'
        when rfm.recency_days <= 30 then '15-30'
        when rfm.recency_days <= 60 then '31-60'
        when rfm.recency_days <= 90 then '61-90'
        else '91+'
      end as recency_bucket
    from analytics.v_customer_master cm
    join analytics.v_rfm_segment rfm on rfm.customer_id = cm.customer_id
    left join analytics.dim_channel dch on dch.id = cm.first_touch_channel_id
    left join cust_province cp on cp.customer_id = cm.customer_id
    left join analytics.dim_geo g on g.province_code = cp.province_code
    left join analytics.v_customer_affinity ca on ca.customer_id = cm.customer_id and ca.shop_id = cm.shop_id
    left join reach rc on rc.customer_id = cm.customer_id;
  $ddlB1$;

  execute $ddlB2$
    grant select on analytics.v_audience to authenticated, service_role;
  $ddlB2$;

  -- Part C
  execute $ddlC1$
    create or replace function analytics.crm_recency_ladder(
      p_shop_id uuid,
      p_include_money boolean default true
    )
     returns jsonb
     language sql
     stable
     security invoker
     set search_path to 'analytics', 'public', 'pg_temp'
    as $bodyC$
      with base as (
        select
          customer_id,
          revenue_sum,
          recency_bucket,
          reachable,
          affinity,
          last_order_at
        from analytics.v_audience
        where shop_id = p_shop_id and order_count > 0
      ),
      cells as (
        select
          recency_bucket as bucket,
          reachable,
          affinity,
          count(*) as customers,
          sum(revenue_sum) as revenue_sum
        from base
        group by recency_bucket, reachable, affinity
      )
      select jsonb_build_object(
        'as_of', (now() at time zone 'Asia/Bangkok')::date,
        'max_order_date', (select max(last_order_at) from base),
        'customers_total', (select count(*) from base),
        'cells', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'bucket', bucket,
              'reachable', reachable,
              'affinity', affinity,
              'customers', customers,
              'revenue', case when p_include_money then revenue_sum end
            )
            order by bucket, reachable, affinity
          )
          from cells
        ), '[]'::jsonb)
      );
    $bodyC$;
  $ddlC1$;

  execute $ddlC2$
    revoke execute on function analytics.crm_recency_ladder(uuid, boolean) from public, anon, authenticated;
  $ddlC2$;
  execute $ddlC3$
    grant  execute on function analytics.crm_recency_ladder(uuid, boolean) to service_role;
  $ddlC3$;

  -- Part D
  execute $ddlD1$
    create or replace function analytics.crm_repeat_cohort(
      p_shop_id uuid,
      p_weeks int default 26
    )
     returns jsonb
     language plpgsql
     stable
     security invoker
     set search_path to 'analytics', 'public', 'pg_temp'
    as $bodyD$
    declare
      v_as_of date;
      v_excluded int;
      v_week_end date;
      v_week_start_floor date;
      v_result jsonb;
    begin
      if p_weeks is null or not (p_weeks between 1 and 104) then
        raise exception 'p_weeks must be between 1 and 104, got %', p_weeks;
      end if;

      select max(order_date) into v_as_of
      from analytics.v_fact_order
      where shop_id = p_shop_id;

      select count(*) into v_excluded
      from analytics.v_fact_order
      where shop_id = p_shop_id and customer_id is null;

      if v_as_of is null then
        return jsonb_build_object(
          'as_of', null,
          'excluded_orders_no_customer', coalesce(v_excluded, 0),
          'weeks', '[]'::jsonb,
          'baseline', '[]'::jsonb
        );
      end if;

      v_week_end := date_trunc('week', v_as_of)::date;
      v_week_start_floor := v_week_end - ((p_weeks - 1) * 7);

      with orders as (
        select
          fo.customer_id,
          fo.order_date,
          fo.channel_id,
          first_value(fo.order_date) over w as first_dt,
          first_value(fo.channel_id) over w as first_channel_id
        from analytics.v_fact_order fo
        where fo.shop_id = p_shop_id and fo.customer_id is not null
        window w as (partition by fo.customer_id order by fo.order_date, fo.id)
      ),
      cust as (
        select
          customer_id, first_dt, first_channel_id,
          bool_or(order_date > first_dt and order_date <= first_dt + 7)  as repeat_7,
          bool_or(order_date > first_dt and order_date <= first_dt + 14) as repeat_14,
          bool_or(order_date > first_dt and order_date <= first_dt + 30) as repeat_30
        from orders
        group by customer_id, first_dt, first_channel_id
      ),
      cohort_base as (
        select
          date_trunc('week', c.first_dt)::date as week_start,
          coalesce(dch.code, 'unknown') as channel_code,
          c.repeat_7, c.repeat_14, c.repeat_30
        from cust c
        left join analytics.dim_channel dch on dch.id = c.first_channel_id
      ),
      agg as (
        select
          week_start,
          case when grouping(channel_code) = 1 then 'all' else channel_code end as channel_code,
          count(*) as new_n,
          count(*) filter (where repeat_7)  as n7,
          count(*) filter (where repeat_14) as n14,
          count(*) filter (where repeat_30) as n30
        from cohort_base
        group by grouping sets ((week_start, channel_code), (week_start))
      ),
      weeks_range as (
        select gs::date as week_start
        from generate_series(v_week_start_floor::timestamp, v_week_end::timestamp, interval '7 days') as gs
      ),
      channels_grid as (
        select distinct channel_code from cohort_base
        union
        select 'all'
      ),
      weeks_grid as (
        select wr.week_start, cg.channel_code
        from weeks_range wr cross join channels_grid cg
      ),
      weeks_out as (
        select
          wg.week_start,
          wg.channel_code,
          coalesce(a.new_n, 0) as new_n,
          coalesce(a.n7, 0)  as n7,
          coalesce(a.n14, 0) as n14,
          coalesce(a.n30, 0) as n30,
          (wg.week_start + 6 + 7  <= v_as_of) as mature_7,
          (wg.week_start + 6 + 14 <= v_as_of) as mature_14,
          (wg.week_start + 6 + 30 <= v_as_of) as mature_30
        from weeks_grid wg
        left join agg a on a.week_start = wg.week_start and a.channel_code = wg.channel_code
      ),
      baseline_pool as (
        select *
        from agg
        where week_start + 6 + 30 <= v_as_of
      ),
      baseline_out as (
        select
          channel_code,
          sum(new_n) as new_n,
          sum(n7)  as n7,
          sum(n14) as n14,
          sum(n30) as n30
        from baseline_pool
        group by channel_code
      )
      select jsonb_build_object(
        'as_of', v_as_of,
        'excluded_orders_no_customer', coalesce(v_excluded, 0),
        'weeks', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'week_start', week_start,
              'channel_code', channel_code,
              'new_n', new_n,
              'w7', jsonb_build_object(
                'n', n7,
                'rate', case when mature_7 and new_n > 0 then round(n7::numeric / new_n, 4) else null end,
                'mature', mature_7
              ),
              'w14', jsonb_build_object(
                'n', n14,
                'rate', case when mature_14 and new_n > 0 then round(n14::numeric / new_n, 4) else null end,
                'mature', mature_14
              ),
              'w30', jsonb_build_object(
                'n', n30,
                'rate', case when mature_30 and new_n > 0 then round(n30::numeric / new_n, 4) else null end,
                'mature', mature_30
              )
            )
            order by week_start, channel_code
          )
          from weeks_out
        ), '[]'::jsonb),
        'baseline', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'channel_code', channel_code,
              'new_n', new_n,
              'w7', jsonb_build_object('n', n7, 'rate', case when new_n > 0 then round(n7::numeric / new_n, 4) else null end),
              'w14', jsonb_build_object('n', n14, 'rate', case when new_n > 0 then round(n14::numeric / new_n, 4) else null end),
              'w30', jsonb_build_object('n', n30, 'rate', case when new_n > 0 then round(n30::numeric / new_n, 4) else null end)
            )
            order by channel_code
          )
          from baseline_out
        ), '[]'::jsonb)
      ) into v_result;

      return v_result;
    end;
    $bodyD$;
  $ddlD1$;

  execute $ddlD2$
    revoke execute on function analytics.crm_repeat_cohort(uuid, int) from public, anon, authenticated;
  $ddlD2$;
  execute $ddlD3$
    grant  execute on function analytics.crm_repeat_cohort(uuid, int) to service_role;
  $ddlD3$;

  -----------------------------------------------------------------------
  -- B1: v_audience AFTER DDL -- same 20 + 2 new, in order
  -----------------------------------------------------------------------
  select string_agg(column_name, ',' order by ordinal_position)
    into v_cols_after
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'v_audience';

  v_log := v_log || format(E'[B1] v_audience columns AFTER DDL:\n  %s\n', v_cols_after);

  begin
    if v_cols_after is distinct from v_cols_expected_after then
      raise exception 'v_audience column list after DDL wrong -- expected:\n  %\ngot:\n  %', v_cols_expected_after, v_cols_after;
    end if;
    v_log := v_log || 'B1 v_audience = 20 old columns (same order) + reachable + recency_bucket: OK' || E'\n';
  exception when others then
    v_log := v_log || 'B1 v_audience column list after DDL: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- B2: getAudience()'s exact select-list (lib/actions/marketing.ts) still
  -- runs without error against the new view.
  -----------------------------------------------------------------------
  begin
    execute
      'select count(*) from (select customer_id, display_name, segment, order_count, revenue_sum, ' ||
      'recency_days, first_order_at, last_order_at, channel_code, channel_name, province_code, ' ||
      'province_name_th, bought_bar, bought_jewelry, bar_revenue, jewelry_revenue, affinity, ' ||
      'bar_order_count, jewelry_order_count from analytics.v_audience where shop_id = $1) t'
      into v_audience_probe_rows
      using v_shop_id;
    v_log := v_log || format('B2 getAudience() select-list still runs OK (%s rows for shop): OK' || E'\n', v_audience_probe_rows);
  exception when others then
    v_log := v_log || 'B2 getAudience() select-list still runs: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- B3: order_count=0 customers never get recency_bucket='0-7' (or any
  -- bucket -- structural check, but verified against real data too)
  -----------------------------------------------------------------------
  select count(*) into v_bad_zero_bucket
  from analytics.v_audience
  where shop_id = v_shop_id and order_count = 0 and recency_bucket is not null;

  v_log := v_log || format('[B3] order_count=0 customers with a non-null recency_bucket = %s (must be 0)\n', v_bad_zero_bucket);

  begin
    if v_bad_zero_bucket <> 0 then
      raise exception 'order_count=0 customer(s) got a recency_bucket -- found %', v_bad_zero_bucket;
    end if;
    v_log := v_log || 'B3 order_count=0 never buckets: OK' || E'\n';
  exception when others then
    v_log := v_log || 'B3 order_count=0 never buckets: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- C1: ladder sum(customers) across cells = count(order_count > 0)
  -----------------------------------------------------------------------
  select analytics.crm_recency_ladder(v_shop_id, true) into v_ladder;

  select coalesce(sum((cell ->> 'customers')::numeric), 0) into v_ladder_sum_customers
  from jsonb_array_elements(v_ladder -> 'cells') cell;

  select count(*) into v_customers_with_orders
  from analytics.v_audience
  where shop_id = v_shop_id and order_count > 0;

  v_log := v_log || format('[C1] ladder cells sum(customers) = %s vs v_audience order_count>0 count = %s\n', v_ladder_sum_customers, v_customers_with_orders);

  begin
    if v_ladder_sum_customers <> v_customers_with_orders then
      raise exception 'ladder cell sum % <> order_count>0 count %', v_ladder_sum_customers, v_customers_with_orders;
    end if;
    v_log := v_log || 'C1 ladder sum(customers) = order_count>0 count: OK' || E'\n';
  exception when others then
    v_log := v_log || 'C1 ladder sum(customers) = order_count>0 count: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- C2: ladder money gate -- p_include_money=false -> revenue null everywhere
  -----------------------------------------------------------------------
  select analytics.crm_recency_ladder(v_shop_id, false) into v_ladder_no_money;

  select count(*) into v_bad_money_leak
  from jsonb_array_elements(v_ladder_no_money -> 'cells') cell
  where (cell ->> 'revenue') is not null;

  v_log := v_log || format('[C2] cells with non-null revenue when p_include_money=false = %s (must be 0)\n', v_bad_money_leak);

  begin
    if v_bad_money_leak <> 0 then
      raise exception 'money leaked into % cell(s) despite p_include_money=false', v_bad_money_leak;
    end if;
    v_log := v_log || 'C2 money gate (p_include_money=false -> revenue always null): OK' || E'\n';
  exception when others then
    v_log := v_log || 'C2 money gate: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- D1: cohort as_of = max(order_date) for the shop
  -----------------------------------------------------------------------
  select max(order_date) into v_expected_as_of
  from analytics.v_fact_order
  where shop_id = v_shop_id;

  select analytics.crm_repeat_cohort(v_shop_id, 26) into v_cohort;
  v_cohort_as_of := (v_cohort ->> 'as_of')::date;

  v_log := v_log || format('[D1] cohort as_of = %s vs max(order_date) for shop = %s\n', v_cohort_as_of, v_expected_as_of);

  begin
    if v_cohort_as_of is distinct from v_expected_as_of then
      raise exception 'cohort as_of % <> max(order_date) %', v_cohort_as_of, v_expected_as_of;
    end if;
    v_log := v_log || 'D1 cohort as_of = max(order_date), not current_date: OK' || E'\n';
  exception when others then
    v_log := v_log || 'D1 cohort as_of: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- D2: every immature cell has rate=null in w7/w14/w30
  -----------------------------------------------------------------------
  select count(*) into v_bad_immature_rate
  from jsonb_array_elements(v_cohort -> 'weeks') w,
       lateral (values ('w7'), ('w14'), ('w30')) as win(key)
  where (w -> win.key ->> 'mature')::boolean is false
    and (w -> win.key ->> 'rate') is not null;

  v_log := v_log || format('[D2] immature cells leaking a non-null rate = %s (must be 0)\n', v_bad_immature_rate);

  begin
    if v_bad_immature_rate <> 0 then
      raise exception 'immature cohort cell(s) leaked a rate -- found %', v_bad_immature_rate;
    end if;
    v_log := v_log || 'D2 immature cells always rate=null: OK' || E'\n';
  exception when others then
    v_log := v_log || 'D2 immature cells always rate=null: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- D3: p_weeks outside [1,104] raises
  -----------------------------------------------------------------------
  begin
    perform analytics.crm_repeat_cohort(v_shop_id, 0);
    v_log := v_log || 'D3a p_weeks=0 should have raised: FAIL (no exception)' || E'\n';
    raise exception 'p_weeks=0 did not raise';
  exception
    when others then
      if sqlerrm like 'p_weeks must be between 1 and 104%' then
        v_log := v_log || 'D3a p_weeks=0 raises as expected: OK' || E'\n';
      else
        v_log := v_log || 'D3a p_weeks=0 raised WRONG error: FAIL - ' || sqlerrm || E'\n';
        raise exception '%', v_log;
      end if;
  end;

  begin
    perform analytics.crm_repeat_cohort(v_shop_id, 105);
    v_log := v_log || 'D3b p_weeks=105 should have raised: FAIL (no exception)' || E'\n';
    raise exception 'p_weeks=105 did not raise';
  exception
    when others then
      if sqlerrm like 'p_weeks must be between 1 and 104%' then
        v_log := v_log || 'D3b p_weeks=105 raises as expected: OK' || E'\n';
      else
        v_log := v_log || 'D3b p_weeks=105 raised WRONG error: FAIL - ' || sqlerrm || E'\n';
        raise exception '%', v_log;
      end if;
  end;

  -----------------------------------------------------------------------
  -- E1/E2: grants + no overload
  -----------------------------------------------------------------------
  select has_function_privilege('anon', 'analytics.crm_recency_ladder(uuid,boolean)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.crm_recency_ladder(uuid,boolean)', 'execute') into v_priv_authenticated;
  select has_function_privilege('service_role', 'analytics.crm_recency_ladder(uuid,boolean)', 'execute') into v_priv_service_role;

  v_log := v_log || format('[E1] crm_recency_ladder privileges: anon=%s authenticated=%s service_role=%s\n', v_priv_anon, v_priv_authenticated, v_priv_service_role);

  begin
    if v_priv_anon is distinct from false or v_priv_authenticated is distinct from false or v_priv_service_role is distinct from true then
      raise exception 'crm_recency_ladder privilege mismatch';
    end if;
    v_log := v_log || 'E1 crm_recency_ladder service_role-only: OK' || E'\n';
  exception when others then
    v_log := v_log || 'E1 crm_recency_ladder privileges: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  select has_function_privilege('anon', 'analytics.crm_repeat_cohort(uuid,int)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.crm_repeat_cohort(uuid,int)', 'execute') into v_priv_authenticated;
  select has_function_privilege('service_role', 'analytics.crm_repeat_cohort(uuid,int)', 'execute') into v_priv_service_role;

  v_log := v_log || format('[E1] crm_repeat_cohort privileges: anon=%s authenticated=%s service_role=%s\n', v_priv_anon, v_priv_authenticated, v_priv_service_role);

  begin
    if v_priv_anon is distinct from false or v_priv_authenticated is distinct from false or v_priv_service_role is distinct from true then
      raise exception 'crm_repeat_cohort privilege mismatch';
    end if;
    v_log := v_log || 'E1 crm_repeat_cohort service_role-only: OK' || E'\n';
  exception when others then
    v_log := v_log || 'E1 crm_repeat_cohort privileges: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  select has_table_privilege('anon', 'analytics.v_audience', 'select') into v_priv_anon_audience;
  v_log := v_log || format('[E1] v_audience anon select = %s (must be false)\n', v_priv_anon_audience);

  begin
    if v_priv_anon_audience is distinct from false then
      raise exception 'v_audience granted to anon -- must not be';
    end if;
    v_log := v_log || 'E1 v_audience not granted to anon: OK' || E'\n';
  exception when others then
    v_log := v_log || 'E1 v_audience anon grant: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  select count(*) into v_fn_count_ladder
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'crm_recency_ladder';
  select count(*) into v_fn_count_cohort
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'crm_repeat_cohort';

  v_log := v_log || format('[E2] pg_proc rows: crm_recency_ladder=%s crm_repeat_cohort=%s (both must be 1)\n', v_fn_count_ladder, v_fn_count_cohort);

  begin
    if v_fn_count_ladder <> 1 or v_fn_count_cohort <> 1 then
      raise exception 'overload detected -- crm_recency_ladder=%, crm_repeat_cohort=%', v_fn_count_ladder, v_fn_count_cohort;
    end if;
    v_log := v_log || 'E2 no overload (exactly 1 row each): OK' || E'\n';
  exception when others then
    v_log := v_log || 'E2 no overload: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- F1: perf -- wall-clock timing (authoritative) + best-effort EXPLAIN
  -----------------------------------------------------------------------
  v_t0 := clock_timestamp();
  perform analytics.crm_recency_ladder(v_shop_id, true);
  v_t1 := clock_timestamp();
  v_ladder_ms := extract(epoch from (v_t1 - v_t0)) * 1000;

  v_t0 := clock_timestamp();
  perform analytics.crm_repeat_cohort(v_shop_id, 26);
  v_t1 := clock_timestamp();
  v_cohort_ms := extract(epoch from (v_t1 - v_t0)) * 1000;

  v_log := v_log || format('[F1] crm_recency_ladder wall-clock = %s ms (target < 150ms)\n', round(v_ladder_ms::numeric, 2));
  v_log := v_log || format('[F1] crm_repeat_cohort  wall-clock = %s ms (target < 150ms)\n', round(v_cohort_ms::numeric, 2));

  v_plan_text := '';
  for v_plan_line in execute format('explain (analyze, buffers) select analytics.crm_recency_ladder(%L::uuid, true)', v_shop_id)
  loop
    v_plan_text := v_plan_text || v_plan_line || E'\n';
  end loop;
  v_log := v_log || E'[F1] crm_recency_ladder EXPLAIN (ANALYZE, BUFFERS):\n' || v_plan_text;

  v_plan_text := '';
  for v_plan_line in execute format('explain (analyze, buffers) select analytics.crm_repeat_cohort(%L::uuid, 26)', v_shop_id)
  loop
    v_plan_text := v_plan_text || v_plan_line || E'\n';
  end loop;
  v_log := v_log || E'[F1] crm_repeat_cohort EXPLAIN (ANALYZE, BUFFERS) -- PL/pgSQL is opaque to the caller''s EXPLAIN (documented Postgres limitation), so this is likely a single "Result" node, NOT the internal query''s real buffer count. Trust the wall-clock number above for this function.\n' || v_plan_text;

  if v_ladder_ms >= 150 then
    v_log := v_log || format('[F1] WARNING: crm_recency_ladder exceeded 150ms target (%s ms) -- report to Tech Lead as technical debt, do not silently ignore.\n', round(v_ladder_ms::numeric, 2));
  end if;
  if v_cohort_ms >= 150 then
    v_log := v_log || format('[F1] WARNING: crm_repeat_cohort exceeded 150ms target (%s ms) -- report to Tech Lead as technical debt, do not silently ignore.\n', round(v_cohort_ms::numeric, 2));
  end if;

  -----------------------------------------------------------------------
  -- Force rollback either way -- nothing from this script ever persists.
  -----------------------------------------------------------------------
  v_log := v_log || E'\n=== ALL CHECKS PASSED (transaction rolled back, nothing persisted) ===\n';
  raise exception '%', v_log;
end $$;
