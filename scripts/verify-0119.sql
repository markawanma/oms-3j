-- scripts/verify-0119.sql
--
-- Self-contained verify script for supabase/migrations/0119 (dashboard trend
-- split). Per skill 3j-migration-traps #11: everything runs inside ONE
-- `do $$ ... $$` block that ALWAYS ends in `raise exception`, so the whole
-- transaction rolls back no matter what -- pass or fail. Read the result from
-- the error message this produces, then decide whether to actually apply
-- 0119 via the MCP `apply_migration` tool separately.
--
-- Shop under test: a7c850ee-6776-4c3e-ba72-ba9e8caba2b7 (same shop used by
-- scripts/verify-0107-0108.sql). Windows are derived from the shop's actual
-- min/max order_date at run time (not hardcoded) so this script stays valid
-- as the dataset grows:
--   1day    = the single most recent order_date
--   30day   = the last 30 days ending on the most recent order_date
--   all     = full min..max order_date range
--   channel = 30day window, filtered to channel 'tiktok'
--   staff_money = 30day window, p_include_money = false (staff role)
--
-- IMPORTANT NOTE ON T1 (read before changing this script): the brief asks
-- for `new - 'trend_split' = golden` (the 8 pre-0119 keys byte-identical).
-- That is almost true but not literally true: 0119 ALSO adds one field,
-- `orders_without_items`, inside the EXISTING `sales_trend` key (per the
-- brief's own CTE `trend` instructions) -- so `new -> 'sales_trend'` differs
-- from golden by that one additive field even though nothing else in
-- sales_trend changed. T1 below therefore strips `orders_without_items` from
-- each `new.sales_trend` row before comparing to golden, and separately
-- (T1b) asserts the stripped field is actually present with a sane value --
-- otherwise a silently-missing field would make T1's equality check pass
-- for the wrong reason. Flagging this explicitly per Tech Lead's brief
-- ("ถ้าคิดว่าสั่งผิดหรือมีช่องเหลือ บอกทันที") rather than silently picking an
-- interpretation -- see PR/handoff notes for the same callout.
--
-- What this checks, in order:
--   T0  golden snapshot sanity: dashboard_charts has exactly 1 pg_proc row
--       BEFORE any DDL, and none of the 5 golden captures already contain a
--       'trend_split' key (catches "0119 already applied out of band" per
--       skill supabase-migrate step 1, before blaming the migration for a
--       diff that was never real).
--   T1  new - 'trend_split' (with sales_trend's orders_without_items
--       stripped) == golden, for EVERY one of the 5 windows.
--   T1b orders_without_items is actually present + <= orders on every
--       sales_trend row that has orders > 0, for every window.
--   T2  no function overload (pg_proc count stays 1 after create-or-replace).
--   T3  execute privileges: anon=false, authenticated=false, service_role=true.
--   T4  structural: trend_split has exactly the 3 keys {first_repeat, rfm,
--       product}, for every window.
--   T5  sum(first_repeat orders/revenue) per day == sales_trend orders/revenue
--       for that day, for every window (days absent from first_repeat count
--       as 0, matching the "not zero-filled" contract).
--   T6  same as T5 but for rfm.
--   T7  sum(product.value) over the whole window == sum(product_mix.revenue)
--       over the whole window, for every window.
--   T8  p_include_money=false (staff_money case only): every first_repeat/rfm
--       row has revenue = null, and product = [].
--   T9  every row's `key` falls inside its allowed domain (first_repeat:
--       unknown/first/repeat; rfm: the 6 v_rfm_segment.segment values +
--       unknown; product: the 4 itm.bucket values) -- for every window.
--   T10 raises with the full pass/fail log, forcing rollback either way.
--
-- After this reports all-OK, apply 0119 for real via `apply_migration`, then
-- run `get_advisors(type: "security")` per the supabase-migrate skill.

do $$
declare
  v_shop_id constant uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7';
  v_log text := E'\n=== verify 0119 (dashboard trend split) ===\n';

  v_min_date date;
  v_max_date date;
  v_fn_count int;

  v_case record;
  v_golden jsonb;
  v_after jsonb;
  v_after_no_split jsonb;
  v_trend_stripped jsonb;

  v_priv_anon          boolean;
  v_priv_authenticated boolean;
  v_priv_service_role  boolean;

  v_diff_count  int;
  v_bad_count   int;
  v_sum_product numeric;
  v_sum_mix     numeric;

  allowed_fr   constant text[] := array['unknown','first','repeat'];
  allowed_rfm  constant text[] := array['champion','loyal','new','standard','at_risk','no_orders','unknown'];
  allowed_prod constant text[] := array['silver_bar','art_toy','other','jewelry'];
begin
  -- Defensive only (see skill 3j-migration-traps #11 note) -- this session is
  -- expected to already run with a role that bypasses RLS (postgres/service_role
  -- via MCP). Harmless if that's already the case.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- Derive test windows from the shop's real order_date range.
  -----------------------------------------------------------------------
  select min(order_date), max(order_date) into v_min_date, v_max_date
  from analytics.v_fact_order where shop_id = v_shop_id;

  if v_min_date is null or v_max_date is null then
    raise exception 'no orders found for shop % -- wrong shop_id or empty test DB, aborting before wasting a golden snapshot', v_shop_id;
  end if;

  create temp table test_cases (
    label text primary key,
    p_from date,
    p_to date,
    p_channel text,
    p_include_money boolean
  );
  insert into test_cases (label, p_from, p_to, p_channel, p_include_money) values
    ('1day',        v_max_date, v_max_date, null, true),
    ('30day',       greatest(v_min_date, v_max_date - 29), v_max_date, null, true),
    ('all',         v_min_date, v_max_date, null, true),
    ('channel',     greatest(v_min_date, v_max_date - 29), v_max_date, 'tiktok', true),
    ('staff_money', greatest(v_min_date, v_max_date - 29), v_max_date, null, false);

  v_log := v_log || format('[setup] shop=%s min_date=%s max_date=%s' || E'\n', v_shop_id, v_min_date, v_max_date);

  -----------------------------------------------------------------------
  -- T0: golden snapshot (BEFORE any DDL change)
  -----------------------------------------------------------------------
  select count(*) into v_fn_count
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'dashboard_charts';

  create temp table golden_charts (label text primary key, j jsonb);

  begin
    if v_fn_count <> 1 then
      raise exception 'expected exactly 1 analytics.dashboard_charts before DDL, found %', v_fn_count;
    end if;

    for v_case in select * from test_cases loop
      select analytics.dashboard_charts(v_shop_id, v_case.p_from, v_case.p_to, v_case.p_channel, v_case.p_include_money) into v_golden;
      if v_golden ? 'trend_split' then
        raise exception '[%] golden ALREADY has a trend_split key -- 0119 (or something like it) is already applied out of band, stop', v_case.label;
      end if;
      insert into golden_charts (label, j) values (v_case.label, v_golden);
      v_log := v_log || format('[golden][%s] from=%s to=%s channel=%s money=%s sales_trend_rows=%s' || E'\n',
        v_case.label, v_case.p_from, v_case.p_to, coalesce(v_case.p_channel,'*'), v_case.p_include_money,
        jsonb_array_length(v_golden -> 'sales_trend'));
    end loop;
    v_log := v_log || 'T0 golden snapshot sanity (pg_proc=1, no pre-existing trend_split): OK' || E'\n';
  exception when others then
    v_log := v_log || 'T0 golden snapshot sanity: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- Apply 0119 DDL verbatim, via EXECUTE on a dollar-quoted string (the
  -- function body's own $$ must not collide with this do block's $$, so it
  -- is renamed to $fn$ only for this embedded copy).
  -----------------------------------------------------------------------
  execute $ddl0119$
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
    as $fn$
      with scope as (
        select case when p_channel is null then null
                    else (select id from analytics.dim_channel where code = p_channel) end as v_channel_id
      ),
      ord as (
        select v.id, v.customer_id, v.channel_id, v.order_date, v.revenue, v.is_new_customer,
               exists (select 1 from analytics.fact_order_item fi where fi.fact_order_id = v.id) as has_items
        from analytics.v_fact_order v, scope s
        where v.shop_id = p_shop_id
          and v.order_date between p_from and p_to
          and (s.v_channel_id is null or v.channel_id = s.v_channel_id)
      ),
      first_order as (
        select distinct on (customer_id) customer_id, id as first_id
        from analytics.v_fact_order
        where shop_id = p_shop_id and customer_id is not null
        order by customer_id, order_date, id
      ),
      itm as (
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
      litm_range as (
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
      split_fr as (
        select o.order_date,
               case when o.customer_id is null then 'unknown'
                    when o.id = f.first_id then 'first' else 'repeat' end as key,
               count(*) as orders, sum(o.revenue) as revenue
        from ord o left join first_order f using (customer_id) group by 1, 2
      ),
      split_rfm as (
        select o.order_date, coalesce(s.segment, 'unknown') as key,
               count(*) as orders, sum(o.revenue) as revenue
        from ord o left join analytics.v_rfm_segment s
               on s.customer_id = o.customer_id and s.shop_id = p_shop_id
        group by 1, 2
      ),
      split_prod as (
        select i.order_date, i.bucket as key, sum(i.line_rev) as value from itm i group by 1, 2
      ),
      trend as (
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
      wk as (
        select coalesce(jsonb_agg(jsonb_build_object('dow', dow,
                 'label', (array['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'])[dow + 1],
                 'orders', orders, 'revenue', case when p_include_money then revenue end) order by dow), '[]') j
        from ( select g.dow, coalesce(count(o.id), 0) orders, coalesce(sum(o.revenue), 0) revenue
               from generate_series(0, 6) g(dow)
               left join ord o on extract(dow from o.order_date)::int = g.dow
               group by g.dow ) t
      ),
      chan_all as (
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
    $fn$;
  $ddl0119$;

  revoke execute on function analytics.dashboard_charts(uuid, date, date, text, boolean) from public, anon, authenticated;
  grant execute on function analytics.dashboard_charts(uuid, date, date, text, boolean) to service_role;

  -----------------------------------------------------------------------
  -- T2: no overload created
  -----------------------------------------------------------------------
  select count(*) into v_fn_count
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'dashboard_charts';

  begin
    if v_fn_count <> 1 then
      raise exception 'analytics.dashboard_charts overloaded after create-or-replace: % rows in pg_proc', v_fn_count;
    end if;
    v_log := v_log || 'T2 no function overload created: OK' || E'\n';
  exception when others then
    v_log := v_log || 'T2 no function overload created: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- T3: execute privileges
  -----------------------------------------------------------------------
  begin
    select has_function_privilege('anon', 'analytics.dashboard_charts(uuid,date,date,text,boolean)', 'execute') into v_priv_anon;
    select has_function_privilege('authenticated', 'analytics.dashboard_charts(uuid,date,date,text,boolean)', 'execute') into v_priv_authenticated;
    select has_function_privilege('service_role', 'analytics.dashboard_charts(uuid,date,date,text,boolean)', 'execute') into v_priv_service_role;
    if v_priv_anon or v_priv_authenticated or not v_priv_service_role then
      raise exception 'dashboard_charts privileges wrong: anon=% authenticated=% service_role=% (want false,false,true)',
        v_priv_anon, v_priv_authenticated, v_priv_service_role;
    end if;
    v_log := v_log || 'T3 execute privileges (anon=false, authenticated=false, service_role=true): OK' || E'\n';
  exception when others then
    v_log := v_log || 'T3 execute privileges: FAIL - ' || sqlerrm || E'\n';
    raise exception '%', v_log;
  end;

  -----------------------------------------------------------------------
  -- T1/T1b/T4/T5/T6/T7/T8/T9: per test-case checks, post-DDL
  -----------------------------------------------------------------------
  for v_case in select * from test_cases loop
    select analytics.dashboard_charts(v_shop_id, v_case.p_from, v_case.p_to, v_case.p_channel, v_case.p_include_money) into v_after;
    select j into v_golden from golden_charts where label = v_case.label;

    -- T1: strip trend_split, then strip orders_without_items from each
    -- sales_trend row, then compare to golden (see file header note).
    begin
      if not (v_after ? 'trend_split') then
        raise exception 'trend_split key missing from output entirely';
      end if;

      select jsonb_agg((elem - 'orders_without_items') order by ord)
        into v_trend_stripped
        from jsonb_array_elements(v_after -> 'sales_trend') with ordinality as t(elem, ord);

      v_after_no_split := (v_after - 'trend_split')
                           || jsonb_build_object('sales_trend', coalesce(v_trend_stripped, '[]'::jsonb));

      if v_after_no_split is distinct from v_golden then
        raise exception 'stripped output differs from golden' || E'\ngolden=%\nafter=%', v_golden, v_after_no_split;
      end if;
      v_log := v_log || format('T1[%s] (new - trend_split, sales_trend.orders_without_items stripped) = golden: OK' || E'\n', v_case.label);
    exception when others then
      v_log := v_log || format('T1[%s]: FAIL - %s' || E'\n', v_case.label, sqlerrm);
      raise exception '%', v_log;
    end;

    -- T1b: orders_without_items actually present and sane (<= orders) on
    -- every day that has orders > 0 -- guards T1 against a silently-missing
    -- field trivially passing the equality check above.
    begin
      select count(*) into v_bad_count
      from jsonb_array_elements(v_after -> 'sales_trend') x
      where (x ->> 'orders')::int > 0
        and (not (x ? 'orders_without_items')
             or (x ->> 'orders_without_items')::int > (x ->> 'orders')::int
             or (x ->> 'orders_without_items')::int < 0);
      if v_bad_count <> 0 then
        raise exception '% sales_trend row(s) with missing/out-of-range orders_without_items', v_bad_count;
      end if;
      v_log := v_log || format('T1b[%s] orders_without_items present and 0 <= value <= orders on every day: OK' || E'\n', v_case.label);
    exception when others then
      v_log := v_log || format('T1b[%s]: FAIL - %s' || E'\n', v_case.label, sqlerrm);
      raise exception '%', v_log;
    end;

    -- T4: trend_split has exactly {first_repeat, rfm, product}, nothing else.
    begin
      select count(*) into v_diff_count
      from jsonb_object_keys(v_after -> 'trend_split') k
      where k not in ('first_repeat', 'rfm', 'product');
      if v_diff_count <> 0 or not (v_after -> 'trend_split' ? 'first_repeat')
         or not (v_after -> 'trend_split' ? 'rfm') or not (v_after -> 'trend_split' ? 'product') then
        raise exception 'trend_split key set wrong: %', (v_after -> 'trend_split');
      end if;
      v_log := v_log || format('T4[%s] trend_split has exactly {first_repeat,rfm,product}: OK' || E'\n', v_case.label);
    exception when others then
      v_log := v_log || format('T4[%s]: FAIL - %s' || E'\n', v_case.label, sqlerrm);
      raise exception '%', v_log;
    end;

    -- T5: sum(first_repeat) per day == sales_trend per day (orders + revenue).
    -- Days absent from first_repeat (zero orders) must count as 0 -- matches
    -- the "not zero-filled" contract for the split arrays.
    begin
      with fr as (
        select (x ->> 'date') as d, sum((x ->> 'orders')::int) as orders,
               sum(coalesce((x ->> 'revenue')::numeric, 0)) as revenue
        from jsonb_array_elements(v_after -> 'trend_split' -> 'first_repeat') x
        group by 1
      ),
      tr as (
        select (x ->> 'date') as d, (x ->> 'orders')::int as orders,
               coalesce((x ->> 'revenue')::numeric, 0) as revenue
        from jsonb_array_elements(v_after -> 'sales_trend') x
      )
      select count(*) into v_diff_count
      from tr left join fr on fr.d = tr.d
      where coalesce(fr.orders, 0) <> tr.orders
         or coalesce(fr.revenue, 0) <> tr.revenue;
      if v_diff_count <> 0 then
        raise exception '% day(s) where sum(first_repeat) != sales_trend', v_diff_count;
      end if;
      v_log := v_log || format('T5[%s] sum(first_repeat) per day == sales_trend per day (orders+revenue): OK' || E'\n', v_case.label);
    exception when others then
      v_log := v_log || format('T5[%s]: FAIL - %s' || E'\n', v_case.label, sqlerrm);
      raise exception '%', v_log;
    end;

    -- T6: same as T5 but for rfm.
    begin
      with rf as (
        select (x ->> 'date') as d, sum((x ->> 'orders')::int) as orders,
               sum(coalesce((x ->> 'revenue')::numeric, 0)) as revenue
        from jsonb_array_elements(v_after -> 'trend_split' -> 'rfm') x
        group by 1
      ),
      tr as (
        select (x ->> 'date') as d, (x ->> 'orders')::int as orders,
               coalesce((x ->> 'revenue')::numeric, 0) as revenue
        from jsonb_array_elements(v_after -> 'sales_trend') x
      )
      select count(*) into v_diff_count
      from tr left join rf on rf.d = tr.d
      where coalesce(rf.orders, 0) <> tr.orders
         or coalesce(rf.revenue, 0) <> tr.revenue;
      if v_diff_count <> 0 then
        raise exception '% day(s) where sum(rfm) != sales_trend', v_diff_count;
      end if;
      v_log := v_log || format('T6[%s] sum(rfm) per day == sales_trend per day (orders+revenue): OK' || E'\n', v_case.label);
    exception when others then
      v_log := v_log || format('T6[%s]: FAIL - %s' || E'\n', v_case.label, sqlerrm);
      raise exception '%', v_log;
    end;

    -- T7: sum(product.value) over the whole window == sum(product_mix.revenue).
    begin
      select coalesce(sum((x ->> 'value')::numeric), 0) into v_sum_product
      from jsonb_array_elements(v_after -> 'trend_split' -> 'product') x;

      select coalesce(sum((x ->> 'revenue')::numeric), 0) into v_sum_mix
      from jsonb_array_elements(v_after -> 'product_mix') x;

      if round(v_sum_product, 2) <> round(v_sum_mix, 2) then
        raise exception 'sum(product.value)=% <> sum(product_mix.revenue)=%', v_sum_product, v_sum_mix;
      end if;
      v_log := v_log || format('T7[%s] sum(trend_split.product.value) == sum(product_mix.revenue): OK (%s)' || E'\n', v_case.label, v_sum_mix);
    exception when others then
      v_log := v_log || format('T7[%s]: FAIL - %s' || E'\n', v_case.label, sqlerrm);
      raise exception '%', v_log;
    end;

    -- T8: p_include_money=false -> every first_repeat/rfm revenue is null,
    -- product = []. Only meaningful for the staff_money case.
    if v_case.label = 'staff_money' then
      begin
        select count(*) into v_bad_count
        from jsonb_array_elements(v_after -> 'trend_split' -> 'first_repeat') x
        where (x ->> 'revenue') is not null;
        if v_bad_count <> 0 then
          raise exception '% first_repeat row(s) with non-null revenue while p_include_money=false', v_bad_count;
        end if;

        select count(*) into v_bad_count
        from jsonb_array_elements(v_after -> 'trend_split' -> 'rfm') x
        where (x ->> 'revenue') is not null;
        if v_bad_count <> 0 then
          raise exception '% rfm row(s) with non-null revenue while p_include_money=false', v_bad_count;
        end if;

        if (v_after -> 'trend_split' -> 'product') <> '[]'::jsonb then
          raise exception 'product is not [] while p_include_money=false: %', (v_after -> 'trend_split' -> 'product');
        end if;
        v_log := v_log || 'T8[staff_money] money gate holds (first_repeat/rfm revenue null, product=[]): OK' || E'\n';
      exception when others then
        v_log := v_log || 'T8[staff_money]: FAIL - ' || sqlerrm || E'\n';
        raise exception '%', v_log;
      end;
    end if;

    -- T9: every key falls inside its allowed domain.
    begin
      select count(*) into v_bad_count
      from jsonb_array_elements(v_after -> 'trend_split' -> 'first_repeat') x
      where not ((x ->> 'key') = any(allowed_fr));
      if v_bad_count <> 0 then
        raise exception '% first_repeat row(s) with key outside %', v_bad_count, allowed_fr;
      end if;

      select count(*) into v_bad_count
      from jsonb_array_elements(v_after -> 'trend_split' -> 'rfm') x
      where not ((x ->> 'key') = any(allowed_rfm));
      if v_bad_count <> 0 then
        raise exception '% rfm row(s) with key outside %', v_bad_count, allowed_rfm;
      end if;

      select count(*) into v_bad_count
      from jsonb_array_elements(v_after -> 'trend_split' -> 'product') x
      where not ((x ->> 'key') = any(allowed_prod));
      if v_bad_count <> 0 then
        raise exception '% product row(s) with key outside %', v_bad_count, allowed_prod;
      end if;
      v_log := v_log || format('T9[%s] every key within its allowed domain: OK' || E'\n', v_case.label);
    exception when others then
      v_log := v_log || format('T9[%s]: FAIL - %s' || E'\n', v_case.label, sqlerrm);
      raise exception '%', v_log;
    end;
  end loop;

  -----------------------------------------------------------------------
  -- Force rollback either way. If every check above logged OK, this
  -- exception is EXPECTED and means "all good, nothing was persisted".
  -----------------------------------------------------------------------
  v_log := v_log || E'\n=== ALL CHECKS PASSED -- rolling back now by design (skill 3j-migration-traps #11). ===\n';
  v_log := v_log || 'No DB state was changed by this script -- safe to now apply 0119 for real via apply_migration.' || E'\n';
  raise exception '%', v_log;
end;
$$;
