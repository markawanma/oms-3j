-- scripts/verify-0110-customer-dimensions.sql
--
-- Self-contained verify script for supabase/migrations/0110
-- (crm_customer_dimensions all/range mode). Per skill 3j-migration-traps
-- #11: everything runs inside ONE `do $$ ... $$` block that ALWAYS ends in
-- `raise exception`, so the whole transaction rolls back no matter what --
-- pass or fail. Read the result from the error message this produces, then
-- decide whether to actually apply 0110 via the MCP `apply_migration` tool
-- separately.
--
-- Shop under test: a7c850ee-6776-4c3e-ba72-ba9e8caba2b7
--
-- What this checks, in order:
--   A1. Golden snapshot via the OLD (uuid) 1-arg signature, taken BEFORE any
--       DDL runs -- and sanity-checked against the Tech Lead's known-good
--       acceptance figures (Sum(total)=3392, Sum(provinces['ไม่ระบุ'])=1528,
--       Sum(channels['TikTok Shop'])=2230, ['LINE OA']=1144, ['Facebook']=18).
--       A mismatch here means the wrong shop/DB, not a bug in 0110 -- stop
--       before blaming the migration for a golden snapshot that was never
--       right to begin with.
--   (applies 0110's DDL verbatim, via EXECUTE on a dollar-quoted string)
--   A2. new(shop,null,null,null)->'all' = golden, exactly (jsonb =).
--   A3. param independence -- 'all' stays byte-for-byte equal to golden
--       under a real date-range filter AND under a real channel filter,
--       proving no parameter can leak into the 'all' partition.
--   A4. new(shop,null,null,null)->'range' = golden (no filter => range and
--       all cover the identical customer set).
--   A5. cross-check against crm_overview_summary's own customer count, with
--       AND without a channel filter -- both must match Sum(range[*].total)
--       exactly, since both use the same "order_date in [from,to] + channel"
--       membership rule over the same base view.
--   A6. invariants across EVERY (mode, fkey): Sum(provinces)=total,
--       Sum(channels)=total, and range.total <= all.total per fkey.
--   A7. semantics -- over the most recent 30 days (Bangkok "today"), the
--       'range' block's at_risk bucket must be absent/zero. This is a hard
--       invariant given v_rfm_segment's own at_risk predicate (last_order_at
--       more than 90 days ago, per 0055): membership in a <=30-day-old
--       window forces last_order_at within that window, which is < 90 days
--       old, which can never be 'at_risk'. If this fails, membership and
--       segment got coupled somewhere (the exact bug the architect flagged).
--   A8. exactly 1 pg_proc row for analytics.crm_customer_dimensions (no
--       leftover overload) + anon/authenticated execute = false,
--       service_role = true, for the new 4-arg signature.
--
-- After this reports all-OK, apply 0110 for real via `apply_migration`, then
-- run `get_advisors(type: "security")` per the supabase-migrate skill.

do $$
declare
  v_shop_id constant uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7';
  v_log text := E'\n=== verify 0110 (crm_customer_dimensions range/channel) ===\n';

  v_golden           jsonb;
  v_new_default      jsonb;
  v_new_range_dates  jsonb;
  v_new_range_chan   jsonb;
  v_new_recent       jsonb;

  v_sum_total        numeric;
  v_sum_unknown_prov numeric;
  v_sum_tiktok       numeric;
  v_sum_line         numeric;
  v_sum_fb           numeric;

  v_fn_count_before  int;
  v_fn_count_after   int;

  v_kpi_customers_all  int;
  v_kpi_customers_line int;
  v_dim_customers_all  numeric;
  v_dim_customers_line numeric;

  v_bad_prov_sum   int;
  v_bad_chan_sum   int;
  v_bad_range_gt_all int;

  v_today_bkk date;
  v_from_30d  date;

  v_priv_anon          boolean;
  v_priv_authenticated boolean;
  v_priv_service_role  boolean;
begin
  -- Defensive only (matches verify-0107-0108.sql's own note) -- this
  -- function does no auth.uid()/role check of its own; harmless if the
  -- session already runs as a role that bypasses RLS.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- A1: golden snapshot (BEFORE any DDL change), via the OLD 1-arg sig
  -----------------------------------------------------------------------
  select count(*) into v_fn_count_before
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'crm_customer_dimensions';

  select analytics.crm_customer_dimensions(v_shop_id) into v_golden;

  select
    sum((val ->> 'total')::numeric),
    sum(coalesce((val -> 'provinces' ->> 'ไม่ระบุ')::numeric, 0)),
    sum(coalesce((val -> 'channels' ->> 'TikTok Shop')::numeric, 0)),
    sum(coalesce((val -> 'channels' ->> 'LINE OA')::numeric, 0)),
    sum(coalesce((val -> 'channels' ->> 'Facebook')::numeric, 0))
  into v_sum_total, v_sum_unknown_prov, v_sum_tiktok, v_sum_line, v_sum_fb
  from jsonb_each(v_golden) as t(fkey, val);

  v_log := v_log || format(E'[A1] pg_proc rows for crm_customer_dimensions BEFORE DDL = %s (must be 1)\n', v_fn_count_before);
  v_log := v_log || format(E'[A1] golden sums: total=%s unknown_province=%s tiktok=%s line_oa=%s facebook=%s\n',
    v_sum_total, v_sum_unknown_prov, v_sum_tiktok, v_sum_line, v_sum_fb);

  begin
    if v_fn_count_before <> 1 then
      raise exception 'expected exactly 1 analytics.crm_customer_dimensions before DDL, found %', v_fn_count_before;
    end if;
    if v_sum_total <> 3392 or v_sum_unknown_prov <> 1528
       or v_sum_tiktok <> 2230 or v_sum_line <> 1144 or v_sum_fb <> 18
    then
      raise exception 'golden mismatch vs acceptance figures -- wrong shop/DB, stop here';
    end if;
    v_log := v_log || 'A1 golden matches acceptance figures: OK' || E'\n';
  exception when others then
    v_log := v_log || 'A1 golden matches acceptance figures: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- Apply 0110's DDL verbatim, in this same (rolled-back) transaction.
  -- One statement per EXECUTE (matches verify-0107-0108.sql's own house
  -- style) -- a single EXECUTE string is not guaranteed to run more than
  -- one ;-separated statement reliably, so each DDL statement gets its own
  -- dollar-quoted call.
  -----------------------------------------------------------------------
  execute $ddl0110drop$
    drop function if exists analytics.crm_customer_dimensions(uuid);
  $ddl0110drop$;

  execute $ddl0110fn$
    create or replace function analytics.crm_customer_dimensions(
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
    as $body110$
      with mem as (
        select distinct v.customer_id
        from analytics.v_fact_order v
        join analytics.dim_channel dch on dch.id = v.channel_id
        where v.shop_id = p_shop_id and v.customer_id is not null
          and (p_from is null or v.order_date >= p_from)
          and (p_to   is null or v.order_date <= p_to)
          and (p_channel_code is null or dch.code = p_channel_code)
      ),
      c as (
        select
          case
            when r.segment = 'champion' and r.value_tier = 'high' then 'champion_high'
            when r.segment = 'champion' and r.value_tier = 'core' then 'champion_core'
            else r.segment
          end as fkey,
          m.latest_province_name as province,
          coalesce(fch.name, 'ไม่ระบุ') as channel,
          (mem.customer_id is not null) as in_range
        from analytics.v_rfm_segment r
        join analytics.v_customer_master m on m.customer_id = r.customer_id
        left join analytics.dim_channel fch on fch.id = m.first_touch_channel_id
        left join mem on mem.customer_id = r.customer_id
        where r.shop_id = p_shop_id and m.order_count > 0
      ),
      cm as (
        select md.mode, c.fkey, c.province, c.channel
        from c cross join (values ('all'), ('range')) as md(mode)
        where md.mode = 'all' or c.in_range
      ),
      prov as (select mode, fkey, province, count(*) as n from cm group by mode, fkey, province),
      chan as (select mode, fkey, channel, count(*) as n from cm group by mode, fkey, channel),
      tot  as (select mode, fkey, count(*) as n from cm group by mode, fkey),
      per_mode as (
        select
          t.mode,
          coalesce(
            jsonb_object_agg(
              t.fkey,
              jsonb_build_object(
                'total', t.n,
                'provinces', coalesce((select jsonb_object_agg(province, n) from prov where prov.mode = t.mode and prov.fkey = t.fkey), '{}'::jsonb),
                'channels',  coalesce((select jsonb_object_agg(channel,  n) from chan where chan.mode = t.mode and chan.fkey = t.fkey), '{}'::jsonb)
              )
            ),
            '{}'::jsonb
          ) as j
        from tot t
        group by t.mode
      )
      select jsonb_build_object(
        'all',   coalesce((select j from per_mode where mode = 'all'),   '{}'::jsonb),
        'range', coalesce((select j from per_mode where mode = 'range'), '{}'::jsonb)
      );
    $body110$;
  $ddl0110fn$;

  execute $ddl0110revoke$
    revoke execute on function analytics.crm_customer_dimensions(uuid, date, date, text) from public, anon, authenticated;
  $ddl0110revoke$;

  execute $ddl0110grant$
    grant execute on function analytics.crm_customer_dimensions(uuid, date, date, text) to service_role;
  $ddl0110grant$;

  -----------------------------------------------------------------------
  -- A2: new(shop,null,null,null)->'all' = golden, exactly
  -----------------------------------------------------------------------
  select analytics.crm_customer_dimensions(v_shop_id, null, null, null) into v_new_default;

  begin
    if (v_new_default -> 'all') <> v_golden then
      raise exception 'new(...)->all <> golden: all=%, golden=%', (v_new_default -> 'all'), v_golden;
    end if;
    v_log := v_log || 'A2 new(null,null,null)->all = golden: OK' || E'\n';
  exception when others then
    v_log := v_log || 'A2 new(null,null,null)->all = golden: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- A3: param independence -- 'all' must stay = golden under ANY filter
  -----------------------------------------------------------------------
  select analytics.crm_customer_dimensions(v_shop_id, '2026-08-01'::date, '2026-08-31'::date, null) into v_new_range_dates;
  select analytics.crm_customer_dimensions(v_shop_id, null, null, 'line_oa') into v_new_range_chan;

  begin
    if (v_new_range_dates -> 'all') <> v_golden then
      raise exception 'date-filtered call leaked into all: %', (v_new_range_dates -> 'all');
    end if;
    if (v_new_range_chan -> 'all') <> v_golden then
      raise exception 'channel-filtered call leaked into all: %', (v_new_range_chan -> 'all');
    end if;
    v_log := v_log || 'A3 param independence (date filter + channel filter both leave all untouched): OK' || E'\n';
  exception when others then
    v_log := v_log || 'A3 param independence: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- A4: new(shop,null,null,null)->'range' = golden (no filter = everyone)
  -----------------------------------------------------------------------
  begin
    if (v_new_default -> 'range') <> v_golden then
      raise exception 'new(...)->range <> golden with no filter applied: range=%, golden=%', (v_new_default -> 'range'), v_golden;
    end if;
    v_log := v_log || 'A4 new(null,null,null)->range = golden: OK' || E'\n';
  exception when others then
    v_log := v_log || 'A4 new(null,null,null)->range = golden: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- A5: cross-check against crm_overview_summary's own customer count,
  -- with AND without a channel filter, over the same Aug-2026 window.
  -----------------------------------------------------------------------
  select sum((val ->> 'total')::numeric) into v_dim_customers_all
  from jsonb_each(v_new_range_dates -> 'range') as t(fkey, val);

  select ((analytics.crm_overview_summary(v_shop_id, '2026-08-01'::date, '2026-08-31'::date, null)) -> 'totals' ->> 'customers')::int
    into v_kpi_customers_all;

  select analytics.crm_customer_dimensions(v_shop_id, '2026-08-01'::date, '2026-08-31'::date, 'line_oa') into v_new_range_chan;
  select sum((val ->> 'total')::numeric) into v_dim_customers_line
  from jsonb_each(v_new_range_chan -> 'range') as t(fkey, val);

  select ((analytics.crm_overview_summary(v_shop_id, '2026-08-01'::date, '2026-08-31'::date, 'line_oa')) -> 'totals' ->> 'customers')::int
    into v_kpi_customers_line;

  v_log := v_log || format(E'[A5] range.total sum (no channel) = %s vs crm_overview_summary.customers = %s\n', v_dim_customers_all, v_kpi_customers_all);
  v_log := v_log || format(E'[A5] range.total sum (line_oa)    = %s vs crm_overview_summary.customers = %s\n', v_dim_customers_line, v_kpi_customers_line);

  begin
    if v_dim_customers_all <> v_kpi_customers_all then
      raise exception 'range total (no channel) %  <>  crm_overview_summary customers %', v_dim_customers_all, v_kpi_customers_all;
    end if;
    if v_dim_customers_line <> v_kpi_customers_line then
      raise exception 'range total (line_oa) %  <>  crm_overview_summary customers %', v_dim_customers_line, v_kpi_customers_line;
    end if;
    v_log := v_log || 'A5 cross-check vs crm_overview_summary (with and without channel): OK' || E'\n';
  exception when others then
    v_log := v_log || 'A5 cross-check vs crm_overview_summary: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- A6: invariants -- every (mode, fkey): Sum(provinces)=total,
  -- Sum(channels)=total; every fkey: range.total <= all.total
  -----------------------------------------------------------------------
  select count(*) into v_bad_prov_sum
  from (
    select 'all' as mode, fkey, val from jsonb_each(v_new_default -> 'all') as t(fkey, val)
    union all
    select 'range' as mode, fkey, val from jsonb_each(v_new_default -> 'range') as t(fkey, val)
  ) buckets
  where (val ->> 'total')::numeric <> (
    select coalesce(sum((p.value)::numeric), 0) from jsonb_each_text(val -> 'provinces') p
  );

  select count(*) into v_bad_chan_sum
  from (
    select 'all' as mode, fkey, val from jsonb_each(v_new_default -> 'all') as t(fkey, val)
    union all
    select 'range' as mode, fkey, val from jsonb_each(v_new_default -> 'range') as t(fkey, val)
  ) buckets
  where (val ->> 'total')::numeric <> (
    select coalesce(sum((p.value)::numeric), 0) from jsonb_each_text(val -> 'channels') p
  );

  select count(*) into v_bad_range_gt_all
  from jsonb_each(v_new_default -> 'all') as a(fkey, aval)
  left join jsonb_each(v_new_default -> 'range') as r(fkey2, rval) on r.fkey2 = a.fkey
  where coalesce((r.rval ->> 'total')::numeric, 0) > (a.aval ->> 'total')::numeric;

  v_log := v_log || format(E'[A6] buckets where sum(provinces)<>total: %s (must be 0)\n', v_bad_prov_sum);
  v_log := v_log || format(E'[A6] buckets where sum(channels)<>total: %s (must be 0)\n', v_bad_chan_sum);
  v_log := v_log || format(E'[A6] fkeys where range.total > all.total: %s (must be 0)\n', v_bad_range_gt_all);

  begin
    if v_bad_prov_sum <> 0 or v_bad_chan_sum <> 0 or v_bad_range_gt_all <> 0 then
      raise exception 'invariant violated -- see counts above';
    end if;
    v_log := v_log || 'A6 invariants (province/channel sums = total, range <= all): OK' || E'\n';
  exception when others then
    v_log := v_log || 'A6 invariants: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- A7: semantics -- last-30-days range must have zero at_risk members
  -----------------------------------------------------------------------
  v_today_bkk := (now() at time zone 'Asia/Bangkok')::date;
  v_from_30d := v_today_bkk - 30; -- date - integer = date (no interval cast needed)

  select analytics.crm_customer_dimensions(v_shop_id, v_from_30d, v_today_bkk, null) into v_new_recent;

  v_log := v_log || format(E'[A7] window %s..%s -- range.at_risk = %s (must be absent/0)\n',
    v_from_30d, v_today_bkk, (v_new_recent -> 'range' -> 'at_risk' ->> 'total'));

  begin
    if coalesce(((v_new_recent -> 'range' -> 'at_risk') ->> 'total')::numeric, 0) <> 0 then
      raise exception 'range block has at_risk members in a <=30-day window: %', (v_new_recent -> 'range' -> 'at_risk');
    end if;
    v_log := v_log || 'A7 semantics (membership=bought-in-range vs segment=today state stay decoupled): OK' || E'\n';
  exception when others then
    v_log := v_log || 'A7 semantics: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- A8: exactly 1 overload, correct EXECUTE privileges
  -----------------------------------------------------------------------
  select count(*) into v_fn_count_after
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'crm_customer_dimensions';

  select has_function_privilege('anon', 'analytics.crm_customer_dimensions(uuid,date,date,text)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.crm_customer_dimensions(uuid,date,date,text)', 'execute') into v_priv_authenticated;
  select has_function_privilege('service_role', 'analytics.crm_customer_dimensions(uuid,date,date,text)', 'execute') into v_priv_service_role;

  v_log := v_log || format(E'[A8] pg_proc rows AFTER DDL = %s (must be 1)\n', v_fn_count_after);
  v_log := v_log || format(E'[A8] execute privileges: anon=%s authenticated=%s service_role=%s\n',
    v_priv_anon, v_priv_authenticated, v_priv_service_role);

  begin
    if v_fn_count_after <> 1 then
      raise exception 'expected exactly 1 analytics.crm_customer_dimensions after DDL (overload leak), found %', v_fn_count_after;
    end if;
    if v_priv_anon is distinct from false or v_priv_authenticated is distinct from false or v_priv_service_role is distinct from true then
      raise exception 'privilege mismatch: anon=%, authenticated=%, service_role=%', v_priv_anon, v_priv_authenticated, v_priv_service_role;
    end if;
    v_log := v_log || 'A8 single overload + service_role-only privileges: OK' || E'\n';
  exception when others then
    v_log := v_log || 'A8 single overload + privileges: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- Force rollback either way -- nothing from this script ever persists.
  -----------------------------------------------------------------------
  v_log := v_log || E'\n=== ALL CHECKS PASSED (transaction rolled back, nothing persisted) ===\n';
  raise exception '%', v_log;
end $$;
