-- 0056_crm_customer_dimensions_rpc.sql
-- Server-side aggregation for the /crm/overview "ลูกค้าตามพื้นที่ & ช่องทาง"
-- panel. The first cut fetched two full customer lists (v_customer_master +
-- v_rfm_segment) into the action and merged in JS — but PostgREST caps each
-- .select() at 1000 rows, so at ~3k customers the two capped 1000-row sets
-- intersected on customer_id to only ~333 rows, silently under-counting every
-- chart. This RPC does the join + histogram entirely in SQL and returns a
-- single jsonb value (no row cap), keyed by the same filter keys the panel's
-- chips use (champion split into champion_high / champion_core, everyone else
-- by segment). Money-free (segment/province/channel counts only), so it stays
-- security_invoker + service_role-grant like the other CRM reads.
--
-- Shape:
--   { "<filter_key>": { "total": int,
--                       "provinces": { "<name>": int, ... },
--                       "channels":  { "<name>": int, ... } }, ... }
-- filter_key ∈ champion_high | champion_core | loyal | new | standard | at_risk
-- (no_orders never appears — order_count > 0 filter below).

create or replace function analytics.crm_customer_dimensions(p_shop_id uuid)
 returns jsonb
 language sql
 stable
 security invoker
 set search_path to 'analytics', 'public', 'pg_temp'
as $$
  with c as (
    select
      case
        when r.segment = 'champion' and r.value_tier = 'high' then 'champion_high'
        when r.segment = 'champion' and r.value_tier = 'core' then 'champion_core'
        else r.segment
      end as fkey,
      m.latest_province_name as province,
      coalesce(dch.name, 'ไม่ระบุ') as channel
    from analytics.v_rfm_segment r
    join analytics.v_customer_master m on m.customer_id = r.customer_id
    left join analytics.dim_channel dch on dch.id = m.first_touch_channel_id
    where r.shop_id = p_shop_id and m.order_count > 0
  ),
  prov as (select fkey, province, count(*) n from c group by fkey, province),
  chan as (select fkey, channel, count(*) n from c group by fkey, channel),
  tot  as (select fkey, count(*) n from c group by fkey)
  select coalesce(
    jsonb_object_agg(
      t.fkey,
      jsonb_build_object(
        'total', t.n,
        'provinces', coalesce((select jsonb_object_agg(province, n) from prov where prov.fkey = t.fkey), '{}'::jsonb),
        'channels',  coalesce((select jsonb_object_agg(channel,  n) from chan where chan.fkey = t.fkey), '{}'::jsonb)
      )
    ),
    '{}'::jsonb
  )
  from tot t;
$$;

revoke execute on function analytics.crm_customer_dimensions(uuid) from public, authenticated;
grant execute on function analytics.crm_customer_dimensions(uuid) to service_role;

notify pgrst, 'reload schema';
