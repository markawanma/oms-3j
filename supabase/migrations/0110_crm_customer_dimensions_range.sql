-- 0110_crm_customer_dimensions_range.sql
-- /crm/overview "ลูกค้าตามพื้นที่ & ช่องทาง" panel currently always shows
-- all-time data even though the page's date/channel filter sits right above
-- it — the owner reasonably assumed the filter applied here too. This adds a
-- second mode ("ตามตัวกรองด้านบน") alongside the existing "ทั้งหมด" one.
--
-- Architect's ruling (do not relitigate here): the date/channel filter picks
-- *who* counts toward a bucket, never *what* their province/first-touch-
-- channel/RFM segment currently is. So:
--   - "ลูกค้าในช่วง" = a customer with >=1 order inside [p_from,p_to] +
--     p_channel_code (order's own channel, i.e. analytics.v_fact_order /
--     dim_channel — the SAME join crm_overview_summary/0043 already uses for
--     its own p_channel_code filter, not first_touch_channel_id).
--   - province / first-touch channel / RFM segment stay each customer's
--     CURRENT (as-of-today) value in BOTH modes — never recomputed for the
--     window. This mirrors crm_overview_summary's existing segment_counts
--     contract (0043's header comment: "segment VALUE itself is each
--     customer's current... state... only membership... is scoped").
--
-- Signature changes (uuid) -> (uuid, date, date, text), so per skill
-- 3j-migration-traps #1 the old 1-arg overload is DROPPED explicitly first —
-- otherwise the new 4-arg-with-defaults overload coexists with the old one
-- and a 1-arg call from PostgREST becomes ambiguous (fails at call time, not
-- at apply time). Grants are re-issued per #2 (a bare `create or replace`
-- does NOT carry privileges forward even when the signature is unchanged,
-- and here it changed anyway) — kept service_role-only, matching 0056.
--
-- Single-scan design (no second RPC round trip, no per-customer subquery —
-- the "buffers 56k->8k" lesson from 0107/0108 that JUST landed on this same
-- pair of base views): `mem` resolves ONE list of customer_ids that count
-- toward "range" (v_fact_order + dim_channel, filtered by p_from/p_to/
-- p_channel_code). `c` is 0056's original per-customer projection
-- (fkey/province/channel) completely unfiltered by any parameter, with one
-- extra boolean column `in_range` (`mem.customer_id is not null` from a LEFT
-- JOIN — never an inner join/filter, so `c`'s row set itself never shrinks
-- based on p_from/p_to/p_channel_code). `cm` cross-joins `c` against the two
-- literal mode labels and keeps a row when mode='all' (unconditional) OR
-- in_range (mode='range' only) — this is what makes the 'all' block provably
-- independent of every parameter: the OR's left branch never inspects
-- `in_range`, so every row of `c` always survives into the 'all' partition
-- regardless of what mem/in_range computed. Grouping then adds `mode` as
-- just another key alongside `fkey`, so provinces/channels/totals are
-- aggregated once per (mode, fkey) instead of running the whole shape twice.
--
-- ⚠️ DO NOT APPLY — file only, per this task's brief (backend-dev writes
-- the migration, Tech Lead applies it via MCP after review).

drop function if exists analytics.crm_customer_dimensions(uuid);

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
as $$
  with mem as (
    -- Who counts toward "range": >=1 order in [p_from,p_to] on channel
    -- p_channel_code. Both bounds + the channel are optional (null = no
    -- constraint on that side) — same "silently permissive when absent"
    -- contract crm_overview_summary/0043 already uses for identical params.
    select distinct v.customer_id
    from analytics.v_fact_order v
    join analytics.dim_channel dch on dch.id = v.channel_id
    where v.shop_id = p_shop_id and v.customer_id is not null
      and (p_from is null or v.order_date >= p_from)
      and (p_to   is null or v.order_date <= p_to)
      and (p_channel_code is null or dch.code = p_channel_code)
  ),
  c as (
    -- 0056's exact per-customer projection (fkey/province/channel), verbatim
    -- and UNFILTERED by any p_from/p_to/p_channel_code — those only ever
    -- reach `in_range`, never gate which rows exist in `c` itself. This is
    -- the load-bearing property that keeps the 'all' block parameter-
    -- independent (see cm below).
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
    -- mode='all' keeps every row of `c` unconditionally (the OR's left
    -- branch is a literal, never touches in_range) — mode='range' keeps only
    -- rows where in_range is true. Two full copies of the shape, one query.
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
$$;

-- service_role only, same as 0056 (money-free but not exposed to PostgREST
-- directly — the app always calls this via lib/actions/crm.ts's
-- service-role client). Supabase grants EXECUTE on new functions to
-- anon/authenticated separately from PUBLIC (supabase-migrate skill gotcha
-- #1), so both must be revoked explicitly, not just `public`.
revoke execute on function analytics.crm_customer_dimensions(uuid, date, date, text) from public, anon, authenticated;
grant  execute on function analytics.crm_customer_dimensions(uuid, date, date, text) to service_role;

notify pgrst, 'reload schema';
