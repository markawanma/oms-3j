-- scripts/verify-0107-0108.sql
--
-- Self-contained verify script for supabase/migrations/0107 + 0108
-- (dashboard perf fix). Per skill 3j-migration-traps #11: everything runs
-- inside ONE `do $$ ... $$` block that ALWAYS ends in `raise exception`, so
-- the whole transaction rolls back no matter what -- pass or fail. Read the
-- result from the error message this produces, then decide whether to
-- actually apply 0107/0108 via the MCP `apply_migration` tool separately.
--
-- Shop under test: a7c850ee-6776-4c3e-ba72-ba9e8caba2b7 (measured baseline:
-- dashboard_summary = 279ms / 56,136 buffers). Window: 2026-08-01..08-31,
-- matching the acceptance figures in the Tech Lead's brief.
--
-- What this checks, in order:
--   1. Snapshots golden state (dashboard_summary, RFM segment counts,
--      v_customer_master, v_marketing_reco, v_audience) BEFORE any DDL,
--      and sanity-checks the golden numbers against the brief's known-good
--      acceptance figures (catches a wrong shop_id/window before blaming
--      the migration for a mismatch that was never real).
--   2. Applies 0107 + 0108's DDL verbatim, via EXECUTE on dollar-quoted
--      strings embedded in this file (not by reading the migration files
--      off disk -- this script is self-contained on purpose).
--   3. Re-snapshots everything and diffs against golden: EXCEPT both
--      directions (0 rows required) for the table-shaped views,
--      jsonb `=` equality for dashboard_summary's return value and for the
--      RFM segment-count comparison.
--   4. Proves the override layer (analytics.crm_order_override, currently
--      0 rows in prod) still flows through correctly post-migration:
--      inserts ONE row overriding revenue+province_code+order_date on a
--      real single-order customer's real order, then asserts
--      v_fact_order / v_customer_master / dashboard_summary.kpi.revenue
--      all move by exactly the expected amount.
--   5. Re-checks the function's EXECUTE privileges (anon/authenticated must
--      be false, service_role true) -- `create or replace function` drops
--      grants even with an unchanged signature (skill supabase-migrate
--      gotcha #1 / 3j-migration-traps #2), so this is the concrete proof
--      the re-grant statements in 0108 actually took effect within this
--      same transaction.
--   6. Raises with the full pass/fail log, forcing rollback either way.
--
-- After this reports all-OK, apply 0107 then 0108 for real via
-- `apply_migration` (each is independently idempotent/safe to re-run), then
-- run `get_advisors(type: "security")` per the supabase-migrate skill.

do $$
declare
  v_shop_id constant uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7';
  v_from    constant date := '2026-08-01';
  v_to      constant date := '2026-08-31';
  v_log text := E'\n=== verify 0107+0108 (dashboard perf) ===\n';

  v_golden_kpi        jsonb;
  v_after_kpi         jsonb;
  v_after_override    jsonb;
  v_diff_count        int;
  v_fn_count          int;

  v_order_id          uuid;
  v_customer_id       uuid;
  v_orig_revenue      numeric(12,2);
  v_orig_province     text;
  v_orig_order_date   date;
  v_new_revenue       numeric(12,2);
  v_new_province      text;
  v_new_order_date    date;
  v_delta             numeric(12,2);

  v_chk_revenue        numeric(12,2);
  v_chk_province       text;
  v_chk_date           date;
  v_chk_revenue_sum    numeric;
  v_chk_latest_prov    text;

  v_priv_anon          boolean;
  v_priv_authenticated boolean;
  v_priv_service_role  boolean;
begin
  -- Defensive only (see skill 3j-migration-traps #11 note) -- dashboard_summary
  -- itself does no auth.uid()/role check, and this session is expected to
  -- already run with a role that bypasses RLS (postgres/service_role via
  -- MCP). Harmless if that's already the case.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- STEP 1: golden snapshot (BEFORE any DDL change)
  -----------------------------------------------------------------------
  create temp table golden_customer_master as
    select * from analytics.v_customer_master;

  create temp table golden_marketing_reco as
    select * from analytics.v_marketing_reco;

  create temp table golden_audience as
    select * from analytics.v_audience;

  create temp table golden_rfm_counts as
    select segment, value_tier, count(*) as cnt
    from analytics.v_rfm_segment
    where shop_id = v_shop_id
    group by segment, value_tier;

  select analytics.dashboard_summary(v_shop_id, v_from, v_to, null, true) into v_golden_kpi;

  select count(*) into v_fn_count
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'dashboard_summary';

  v_log := v_log || format(E'[golden] dashboard_summary.kpi = %s\n', v_golden_kpi -> 'kpi');
  v_log := v_log || format(E'[golden] pg_proc rows for analytics.dashboard_summary BEFORE = %s (must be 1)\n', v_fn_count);

  -- T0: golden itself must match the Tech Lead's known-good acceptance
  -- figures -- if this fails, the snapshot/window/shop is wrong and every
  -- later comparison is meaningless, so fail fast here.
  begin
    if v_fn_count <> 1 then
      raise exception 'expected exactly 1 analytics.dashboard_summary before DDL, found %', v_fn_count;
    end if;
    if round((v_golden_kpi -> 'kpi' ->> 'revenue')::numeric) <> 817964
       or (v_golden_kpi -> 'kpi' ->> 'orders')::int <> 1528
       or round((v_golden_kpi -> 'kpi' ->> 'profit')::numeric) <> 163804
       or round((v_golden_kpi -> 'kpi' ->> 'aov')::numeric) <> 535
       or round((v_golden_kpi -> 'kpi' ->> 'repeat_rate')::numeric * 100) <> 48
    then
      raise exception 'golden KPI mismatch vs acceptance figures: %', (v_golden_kpi -> 'kpi');
    end if;
    if not exists (select 1 from golden_rfm_counts where segment = 'new'       and cnt = 470)
       or not exists (select 1 from golden_rfm_counts where segment = 'loyal'     and cnt = 621)
       or not exists (select 1 from golden_rfm_counts where segment = 'at_risk'   and cnt = 1477)
       or not exists (select 1 from golden_rfm_counts where segment = 'standard'  and cnt = 504)
       or not exists (select 1 from golden_rfm_counts where segment = 'no_orders' and cnt = 83)
       or not exists (select 1 from golden_rfm_counts where value_tier = 'high'   and cnt = 145)
    then
      raise exception 'golden RFM segment/value_tier counts mismatch vs acceptance figures';
    end if;
    v_log := v_log || 'T0 golden matches acceptance figures (kpi + rfm): OK' || E'\n';
  exception when others then
    v_log := v_log || 'T0 golden matches acceptance figures: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- STEP 2: apply 0107 + 0108 DDL, verbatim, via EXECUTE on dollar-quoted
  -- strings (required for the function body's own $$ quoting to not
  -- collide with this do block's $$ delimiters). All in this transaction,
  -- rolled back at the bottom regardless of outcome.
  -----------------------------------------------------------------------
  execute $ddl0107$
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
  $ddl0107$;

  grant select on analytics.v_customer_master to authenticated, service_role;

  execute $ddl0108a$
    create or replace view analytics.v_fact_order
      with (security_invoker = true) as
    select fo.id,
        fo.shop_id,
        fo.oms_order_id,
        fo.source_order_no,
        fo.customer_id,
        coalesce((ov.overrides ->> 'channel_id')::uuid, fo.channel_id) as channel_id,
        fo.campaign_id_first,
        fo.campaign_id_last,
        coalesce((ov.overrides ->> 'order_date')::date, fo.order_date) as order_date,
        fo.paid_at,
        fo.printed_at,
        fo.ship_date,
        fo.estimated_delivery_date,
        coalesce(ov.overrides ->> 'province_code', fo.province_code) as province_code,
        fo.carrier_code,
        fo.tracking_no,
        fo.item_count,
        coalesce((ov.overrides ->> 'revenue')::numeric(12,2), fo.revenue) as revenue,
        coalesce((ov.overrides ->> 'discount')::numeric(12,2), fo.discount) as discount,
        fo.shipping_fee_customer,
        fo.shipping_cost_shop,
        fo.cogs,
        case
          when fo.profit_status = 'estimated'::analytics.profit_status_t then
            round(coalesce((ov.overrides ->> 'revenue')::numeric(12,2), fo.revenue)
                  * coalesce(ss.blended_margin_pct, 0.20), 2)::numeric(12,2)
          else fo.profit
        end as profit,
        fo.profit_status,
        fo.payment_method,
        coalesce(ov.overrides ->> 'bank', fo.bank) as bank,
        fo.is_new_customer,
        coalesce((select array_agg(t.value) from jsonb_array_elements_text(ov.overrides -> 'tags') t(value)), fo.tags) as tags,
        fo.created_at,
        fo.updated_at,
        ov.fact_order_id is not null as is_edited
       from analytics.fact_order fo
         left join analytics.crm_order_override ov on ov.fact_order_id = fo.id
         left join analytics.shop_setting ss on ss.shop_id = fo.shop_id;
  $ddl0108a$;

  grant select on analytics.v_fact_order to authenticated, service_role;

  execute $ddl0108b$
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
    as $fn$
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
          'repeat_rate', (select case when count(*) > 0
                            then round(count(*) filter (where lt.cnt >= 2)::numeric / count(*), 4)
                            else 0 end
                          from (
                            select distinct customer_id from analytics.v_fact_order
                            where shop_id = p_shop_id and order_date between p_from and p_to and customer_id is not null
                              and (v_channel_id is null or channel_id = v_channel_id)
                          ) c
                          join (
                            select customer_id, count(*) cnt from analytics.v_fact_order
                            where shop_id = p_shop_id and customer_id is not null
                            group by customer_id
                          ) lt using (customer_id))
        ) into v_kpi
        from analytics.v_fact_order
        where shop_id = p_shop_id and order_date between p_from and p_to
          and (v_channel_id is null or channel_id = v_channel_id);

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
    $fn$;
  $ddl0108b$;

  revoke execute on function analytics.dashboard_summary(uuid, date, date, text, boolean) from public, anon, authenticated;
  grant execute on function analytics.dashboard_summary(uuid, date, date, text, boolean) to service_role;

  select count(*) into v_fn_count
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'dashboard_summary';

  v_log := v_log || format(E'[step2] DDL applied. pg_proc rows for analytics.dashboard_summary AFTER = %s (must still be 1 -- no overload)\n', v_fn_count);

  begin
    if v_fn_count <> 1 then
      raise exception 'analytics.dashboard_summary overloaded after create-or-replace: % rows in pg_proc', v_fn_count;
    end if;
    v_log := v_log || 'T1 no function overload created: OK' || E'\n';
  exception when others then
    v_log := v_log || 'T1 no function overload created: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -- T2: grants -- prove the revoke/grant in 0108 actually took effect in
  -- THIS transaction (skill supabase-migrate gotcha #1 verification method).
  begin
    select has_function_privilege('anon', 'analytics.dashboard_summary(uuid,date,date,text,boolean)', 'execute') into v_priv_anon;
    select has_function_privilege('authenticated', 'analytics.dashboard_summary(uuid,date,date,text,boolean)', 'execute') into v_priv_authenticated;
    select has_function_privilege('service_role', 'analytics.dashboard_summary(uuid,date,date,text,boolean)', 'execute') into v_priv_service_role;
    if v_priv_anon or v_priv_authenticated or not v_priv_service_role then
      raise exception 'dashboard_summary privileges wrong: anon=% authenticated=% service_role=% (want false,false,true)',
        v_priv_anon, v_priv_authenticated, v_priv_service_role;
    end if;
    v_log := v_log || 'T2 execute privileges (anon=false, authenticated=false, service_role=true): OK' || E'\n';
  exception when others then
    v_log := v_log || 'T2 execute privileges: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- STEP 3: re-snapshot and diff against golden (no data changed yet --
  -- only DDL -- every one of these must show ZERO drift)
  -----------------------------------------------------------------------
  select analytics.dashboard_summary(v_shop_id, v_from, v_to, null, true) into v_after_kpi;

  begin
    if v_after_kpi is distinct from v_golden_kpi then
      raise exception 'dashboard_summary jsonb changed after DDL' || E'\nbefore=%\nafter=%', v_golden_kpi, v_after_kpi;
    end if;
    v_log := v_log || 'T3a dashboard_summary jsonb equality (before DDL vs after DDL): OK' || E'\n';
  exception when others then
    v_log := v_log || 'T3a dashboard_summary jsonb equality: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  begin
    select count(*) into v_diff_count from (
      (select * from golden_customer_master except select * from analytics.v_customer_master)
      union all
      (select * from analytics.v_customer_master except select * from golden_customer_master)
    ) d;
    if v_diff_count <> 0 then
      raise exception '% differing rows', v_diff_count;
    end if;
    v_log := v_log || 'T3b v_customer_master except-both-ways (0 diff): OK' || E'\n';
  exception when others then
    v_log := v_log || 'T3b v_customer_master except-both-ways: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  begin
    select count(*) into v_diff_count from (
      (select * from golden_marketing_reco except select * from analytics.v_marketing_reco)
      union all
      (select * from analytics.v_marketing_reco except select * from golden_marketing_reco)
    ) d;
    if v_diff_count <> 0 then
      raise exception '% differing rows', v_diff_count;
    end if;
    v_log := v_log || 'T3c v_marketing_reco except-both-ways (0 diff, out-of-scope view unaffected): OK' || E'\n';
  exception when others then
    v_log := v_log || 'T3c v_marketing_reco except-both-ways: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  begin
    select count(*) into v_diff_count from (
      (select * from golden_audience except select * from analytics.v_audience)
      union all
      (select * from analytics.v_audience except select * from golden_audience)
    ) d;
    if v_diff_count <> 0 then
      raise exception '% differing rows -- CAMPAIGN AUDIENCE DRIFT, do not apply', v_diff_count;
    end if;
    v_log := v_log || 'T3d v_audience except-both-ways (0 diff -- audience used for real campaigns): OK' || E'\n';
  exception when others then
    v_log := v_log || 'T3d v_audience except-both-ways: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  begin
    select count(*) into v_diff_count from (
      (select segment, value_tier, count(*) as cnt from analytics.v_rfm_segment where shop_id = v_shop_id group by segment, value_tier
       except select * from golden_rfm_counts)
      union all
      (select * from golden_rfm_counts
       except select segment, value_tier, count(*) as cnt from analytics.v_rfm_segment where shop_id = v_shop_id group by segment, value_tier)
    ) d;
    if v_diff_count <> 0 then
      raise exception '% differing (segment,value_tier,count) rows', v_diff_count;
    end if;
    v_log := v_log || 'T3e v_rfm_segment counts except-both-ways (0 diff): OK' || E'\n';
  exception when others then
    v_log := v_log || 'T3e v_rfm_segment counts except-both-ways: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- STEP 4: override layer still works post-migration. Pick a REAL order
  -- belonging to a customer with exactly ONE order in this shop's window,
  -- so overriding it unambiguously makes it that customer's one-and-only
  -- (hence "latest") order -- no ambiguity from the order_date/id tie-break
  -- rule. crm_order_override has 0 rows in prod today, so this is the only
  -- way to prove the override path isn't silently broken.
  -----------------------------------------------------------------------
  select fo.id, fo.customer_id, fo.revenue, fo.province_code, fo.order_date
    into v_order_id, v_customer_id, v_orig_revenue, v_orig_province, v_orig_order_date
  from analytics.fact_order fo
  join (
    select customer_id from analytics.fact_order
    where shop_id = v_shop_id and customer_id is not null
    group by customer_id having count(*) = 1
  ) single_cust on single_cust.customer_id = fo.customer_id
  where fo.shop_id = v_shop_id
    and fo.order_date between v_from and v_to
    and not exists (select 1 from analytics.crm_order_override ov where ov.fact_order_id = fo.id)
  order by fo.id
  limit 1;

  if v_order_id is null then
    v_log := v_log || 'T4 setup: FAIL - no eligible single-order customer found in shop/window' || E'\n';
    raise exception '%', v_log;
  end if;

  select province_code into v_new_province
  from analytics.dim_geo
  where province_code <> coalesce(v_orig_province, '') and coalesce(is_unknown, false) = false
  order by province_code
  limit 1;

  if v_new_province is null then
    v_log := v_log || 'T4 setup: FAIL - no alternate non-unknown province_code found in dim_geo' || E'\n';
    raise exception '%', v_log;
  end if;

  v_new_revenue := v_orig_revenue + 1234.56;
  -- keep the overridden date inside [v_from, v_to] regardless of where in
  -- August the original order fell, so it stays in-scope for kpi both
  -- before and after (this is a test of the override plumbing, not of
  -- window-boundary behaviour).
  v_new_order_date := case when extract(day from v_orig_order_date) < 28
                            then v_orig_order_date + 1
                            else v_orig_order_date - 1 end;
  v_delta := v_new_revenue - v_orig_revenue;

  v_log := v_log || format(
    '[override] order=%s customer=%s revenue %s->%s province %s->%s order_date %s->%s (delta=%s)' || E'\n',
    v_order_id, v_customer_id, v_orig_revenue, v_new_revenue, v_orig_province, v_new_province,
    v_orig_order_date, v_new_order_date, v_delta
  );

  insert into analytics.crm_order_override (fact_order_id, shop_id, overrides, reason, updated_by, updated_at)
  values (
    v_order_id, v_shop_id,
    jsonb_build_object(
      'revenue', v_new_revenue,
      'province_code', v_new_province,
      'order_date', to_char(v_new_order_date, 'YYYY-MM-DD')
    ),
    'verify-0107-0108.sql test row -- rolled back, never committed',
    null, now()
  );

  begin
    select revenue, province_code, order_date into v_chk_revenue, v_chk_province, v_chk_date
    from analytics.v_fact_order where id = v_order_id;

    if v_chk_revenue is distinct from v_new_revenue
       or v_chk_province is distinct from v_new_province
       or v_chk_date is distinct from v_new_order_date then
      raise exception 'v_fact_order did not reflect override: got (%,%,%) expected (%,%,%)',
        v_chk_revenue, v_chk_province, v_chk_date, v_new_revenue, v_new_province, v_new_order_date;
    end if;
    v_log := v_log || 'T4a v_fact_order reflects override (revenue, province_code, order_date): OK' || E'\n';
  exception when others then
    v_log := v_log || 'T4a v_fact_order reflects override: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  begin
    select revenue_sum, latest_province_code into v_chk_revenue_sum, v_chk_latest_prov
    from analytics.v_customer_master where customer_id = v_customer_id;

    -- single-order customer: revenue_sum == that one order's (overridden) revenue exactly.
    if v_chk_revenue_sum is distinct from v_new_revenue then
      raise exception 'v_customer_master.revenue_sum wrong after override: got % expected %', v_chk_revenue_sum, v_new_revenue;
    end if;
    if v_chk_latest_prov is distinct from v_new_province then
      raise exception 'v_customer_master.latest_province_code wrong after override: got % expected %', v_chk_latest_prov, v_new_province;
    end if;
    v_log := v_log || 'T4b v_customer_master reflects override (revenue_sum, latest_province_code): OK' || E'\n';
  exception when others then
    v_log := v_log || 'T4b v_customer_master reflects override: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  select analytics.dashboard_summary(v_shop_id, v_from, v_to, null, true) into v_after_override;

  begin
    if round(((v_after_override -> 'kpi' ->> 'revenue')::numeric - (v_golden_kpi -> 'kpi' ->> 'revenue')::numeric), 2) <> v_delta then
      raise exception 'kpi.revenue delta wrong: got % expected %',
        round(((v_after_override -> 'kpi' ->> 'revenue')::numeric - (v_golden_kpi -> 'kpi' ->> 'revenue')::numeric), 2), v_delta;
    end if;
    v_log := v_log || format('T4c dashboard_summary kpi.revenue moved by exactly the override delta (%s): OK' || E'\n', v_delta);
  exception when others then
    v_log := v_log || 'T4c dashboard_summary kpi.revenue delta: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- STEP 5: force rollback either way. If every T-check above logged OK,
  -- this exception is EXPECTED and means "all good, nothing was persisted".
  -----------------------------------------------------------------------
  v_log := v_log || E'\n=== ALL CHECKS PASSED -- rolling back now by design (skill 3j-migration-traps #11). ===\n';
  v_log := v_log || 'No DB state was changed by this script -- safe to now apply 0107 then 0108 for real via apply_migration.' || E'\n';
  raise exception '%', v_log;
end;
$$;
