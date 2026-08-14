-- 0020_crm_b1_views.sql
-- Phase B1 (CRM read layer + data quality) — DB layer only, per:
--   docs/3j-jewelry/analytics/phase-b-crm-design.md
--     §0 (marts = plain view, invoker security, no matview until slow-for-real)
--     §2.4 (views/marts) · §2.5 (error_code) · §2.7 (RLS/PII) · Decisions LOCKED
--
-- Scope of this file (backend-dev / Han Solo):
--   1. profit margin placeholder 10% -> 20% (Decision Q3) — transform proc +
--      one-time recompute of the 334 rows already loaded with the old 10%.
--   2. stg_order_import.error_code (Decision §2.5) — typed companion to the
--      existing free-text error_detail, so /crm/import-errors can GROUP BY a
--      finite set of codes instead of parsing prose.
--   3. B1 read-layer views — all plain (non-materialized) views, created
--      WITH (security_invoker = true). This is REQUIRED, not optional: a
--      Postgres view is security-DEFINER for RLS by default (RLS on the
--      underlying tables is evaluated as the view OWNER, which bypasses tenant
--      isolation + PII policies). security_invoker=true makes RLS evaluate as
--      the querying role instead, so these views inherit RLS from
--      analytics.fact_order / analytics.dim_customer / analytics.stg_* as-is.
--      (PG 15+; this project is PG 17.) None select any column from pii_customer —
--      customer 360 queries PII separately so staff (RLS-filtered) never gets
--      a PII leak through a mart join (§2.7 hard rule).
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

-- ============================================================================
-- 1. Profit margin 10% -> 20% (Decision Q3)
-- ============================================================================

-- create-or-replace of analytics.transform_pending_orders, identical to
-- 0019_transform_channel_case_insensitive.sql (the latest applied version —
-- case-insensitive channel_raw lookup) except the estimated-margin literal.
-- The 0.10 literal appears exactly once in the function body (the INSERT
-- ... VALUES list); the ON CONFLICT DO UPDATE branch sets
-- `profit = excluded.profit`, which reuses that same computed value rather
-- than repeating the literal, so there is nothing to change there.
--
-- PLACEHOLDER NOTE (still true at 20%): there is no real per-SKU cost yet —
-- profit_status stays 'estimated' at 20% of revenue until actual COGS is
-- fed in. Every UI surfacing profit/LTV must keep the "ประมาณการ 20%" label.
create or replace function analytics.transform_pending_orders(p_shop_id uuid, p_batch_id uuid)
 returns table(transformed_count integer, errored_count integer)
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_row analytics.stg_order_import%rowtype;
  v_channel_id uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_phone_norm text;
  v_phone_hash text;
  v_province_code text;
  v_order_date date;
  v_tags text[];
  v_fact_order_id uuid;
  v_is_new_customer boolean;
  v_transformed int := 0;
  v_errored int := 0;
begin
  if p_shop_id is null or p_batch_id is null then
    raise exception 'transform_pending_orders: p_shop_id and p_batch_id are required';
  end if;

  for v_row in
    select *
    from analytics.stg_order_import
    where shop_id = p_shop_id
      and batch_id = p_batch_id
      and source_kind = 'excel'
      and import_status in ('pending', 'error')
    order by source_row_no
  loop
    begin
      v_channel_id := null;
      v_customer_id := null;
      v_phone_norm := null;
      v_phone_hash := null;

      select dca.channel_id into v_channel_id
        from analytics.dim_channel_alias dca
        where lower(dca.alias_raw) = lower(trim(coalesce(v_row.channel_raw, '')));

      if v_channel_id is null then
        update analytics.stg_order_import
          set import_status = 'error',
              error_detail = 'no dim_channel_alias match for channel_raw: ' || coalesce(v_row.channel_raw, '<null>'),
              error_code = 'channel_alias_missing'
          where id = v_row.id;
        v_errored := v_errored + 1;
        continue;
      end if;

      if v_row.order_created_at is null then
        update analytics.stg_order_import
          set import_status = 'error',
              error_detail = 'order_created_at is null, cannot derive order_date',
              error_code = 'order_date_missing'
          where id = v_row.id;
        v_errored := v_errored + 1;
        continue;
      end if;
      v_order_date := v_row.order_created_at::date;

      v_phone_norm := analytics.normalize_th_phone(v_row.phone_raw);

      if v_phone_norm is not null then
        v_phone_hash := encode(digest(v_phone_norm, 'sha256'), 'hex');
        insert into analytics.dim_customer (shop_id, display_name, primary_phone_hash, first_touch_channel_id)
        values (p_shop_id, v_row.customer_name_raw, v_phone_hash, v_channel_id)
        on conflict (shop_id, primary_phone_hash) where primary_phone_hash is not null and merged_into_id is null
        do update set display_name = coalesce(excluded.display_name, analytics.dim_customer.display_name), updated_at = now()
        returning id into v_customer_id;

        insert into analytics.dim_customer_identity (shop_id, customer_id, identity_type, identity_value_norm, identity_value_hash, confidence)
        values (p_shop_id, v_customer_id, 'phone', v_phone_norm, v_phone_hash, 'exact')
        on conflict (shop_id, identity_type, identity_value_norm)
        do update set customer_id = excluded.customer_id, updated_at = now();

        insert into analytics.pii_customer (customer_id, shop_id, phone_e164, full_name)
        values (v_customer_id, p_shop_id, v_phone_norm, v_row.customer_name_raw)
        on conflict (customer_id)
        do update set phone_e164 = excluded.phone_e164, full_name = coalesce(excluded.full_name, analytics.pii_customer.full_name), updated_at = now();
      else
        v_customer_name := nullif(trim(coalesce(v_row.customer_name_raw, '')), '');
        if v_customer_name is not null then
          insert into analytics.dim_customer (shop_id, display_name, first_touch_channel_id)
          values (p_shop_id, v_customer_name, v_channel_id)
          returning id into v_customer_id;
          insert into analytics.pii_customer (customer_id, shop_id, full_name)
          values (v_customer_id, p_shop_id, v_customer_name);
        else
          v_customer_id := null;
        end if;
      end if;

      -- province via dim_geo_alias (Shipnity spelling + ISO en/th) -> code, TH-XX fallback
      select ga.province_code into v_province_code
        from analytics.dim_geo_alias ga
        where ga.alias_raw = trim(coalesce(v_row.province_raw, ''));
      v_province_code := coalesce(v_province_code, 'TH-XX');

      if v_row.tags_raw is null or trim(v_row.tags_raw) = '' then
        v_tags := null;
      else
        select array_agg(trim(t)) into v_tags
          from unnest(string_to_array(v_row.tags_raw, ',')) as t where trim(t) <> '';
      end if;

      if v_customer_id is not null then
        select not exists (select 1 from analytics.fact_order fo
          where fo.customer_id = v_customer_id and fo.shop_id = p_shop_id and fo.order_date < v_order_date)
          into v_is_new_customer;
      else
        v_is_new_customer := null;
      end if;

      insert into analytics.fact_order (
        shop_id, source_order_no, customer_id, channel_id, order_date, paid_at, printed_at,
        province_code, carrier_code, tracking_no, item_count, revenue, discount,
        shipping_fee_customer, shipping_cost_shop, profit, profit_status, bank, tags, is_new_customer
      ) values (
        p_shop_id, v_row.source_order_no, v_customer_id, v_channel_id, v_order_date, v_row.paid_at, v_row.printed_at,
        v_province_code, v_row.carrier_raw, v_row.tracking_no, v_row.item_count_total, coalesce(v_row.revenue, 0), coalesce(v_row.discount_total, 0),
        v_row.shipping_fee_customer, v_row.shipping_cost_shop, round(coalesce(v_row.revenue, 0) * 0.20, 2), 'estimated', v_row.bank_raw, v_tags, v_is_new_customer
      )
      on conflict (shop_id, source_order_no) do update set
        customer_id = excluded.customer_id, channel_id = excluded.channel_id, order_date = excluded.order_date,
        paid_at = excluded.paid_at, printed_at = excluded.printed_at, province_code = excluded.province_code,
        carrier_code = excluded.carrier_code, tracking_no = excluded.tracking_no, item_count = excluded.item_count,
        revenue = excluded.revenue, discount = excluded.discount, shipping_fee_customer = excluded.shipping_fee_customer,
        shipping_cost_shop = excluded.shipping_cost_shop, profit = excluded.profit, profit_status = excluded.profit_status,
        bank = excluded.bank, tags = excluded.tags, updated_at = now()
      returning id into v_fact_order_id;

      update analytics.stg_order_import
        set fact_order_id = v_fact_order_id, import_status = 'transformed', error_detail = null, error_code = null
        where id = v_row.id;
      v_transformed := v_transformed + 1;
    exception
      when others then
        update analytics.stg_order_import
          set import_status = 'error', error_detail = sqlerrm, error_code = 'exception'
          where id = v_row.id;
        v_errored := v_errored + 1;
    end;
  end loop;

  return query select v_transformed, v_errored;
end;
$function$;

revoke execute on function analytics.transform_pending_orders(uuid,uuid) from public, anon, authenticated;
grant execute on function analytics.transform_pending_orders(uuid,uuid) to service_role;

-- One-time recompute of rows already loaded under the old 10% placeholder.
-- Scoped to profit_status = 'estimated' only — 'actual'/'missing' rows (none
-- exist yet, but future-proofed) are never touched by a blanket margin bump.
update analytics.fact_order
  set profit = round(revenue * 0.20, 2),
      updated_at = now()
  where profit_status = 'estimated';

-- ============================================================================
-- 2. stg_order_import.error_code (Decision §2.5)
-- ============================================================================

alter table analytics.stg_order_import add column if not exists error_code text;

comment on column analytics.stg_order_import.error_code is
  'Typed companion to error_detail (free text) for /crm/import-errors grouping. '
  'Values set by transform_pending_orders today: channel_alias_missing, '
  'order_date_missing, exception. phone_invalid has no dedicated branch in the '
  'proc yet (normalize_th_phone silently falls through to the no-phone path) — '
  'not guessed here, left as a known gap.';

-- ============================================================================
-- 3. B1 read-layer views (plain views, security_invoker=true, no raw PII columns)
-- ============================================================================

-- v_fact_order — B1 is a straight passthrough. B2 will swap the body to
-- `fact_order LEFT JOIN crm_order_override ... coalesce(...)` once the
-- override layer exists (§2.1); every mart below already reads through this
-- view (not analytics.fact_order directly) so that swap is transparent to
-- everything created here.
create or replace view analytics.v_fact_order
  with (security_invoker = true) as
select *
from analytics.fact_order;

-- v_customer_master — one row per master customer (merged_into_id is null)
-- with order/revenue/profit aggregates computed live from v_fact_order.
-- Deliberately NOT reusing dim_customer.first_order_at/last_order_at: the
-- transform proc never populates those two columns today, so trusting them
-- here would silently show nulls/stale values — aggregating from fact rows
-- is the only source that's actually correct right now.
-- display_name is kept (customer-owned profile data, not the §2.7 PII tier —
-- that tier is phone/address/full_name in pii_customer only); no join to
-- pii_customer anywhere in this view.
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
  coalesce(idn.identities_count, 0) as identities_count
from analytics.dim_customer dc
left join (
  select
    v.customer_id,
    count(*) as order_count,
    sum(v.revenue) as revenue_sum,
    sum(v.profit) as profit_sum,
    min(v.order_date) as first_order_at,
    max(v.order_date) as last_order_at
  from analytics.v_fact_order v
  where v.customer_id is not null
  group by v.customer_id
) fo on fo.customer_id = dc.id
left join (
  select ci.customer_id, count(*) as identities_count
  from analytics.dim_customer_identity ci
  group by ci.customer_id
) idn on idn.customer_id = dc.id
where dc.merged_into_id is null;

-- v_rfm_segment — fixed-threshold RFM (Decision Q2), not ntile: at N=310
-- customers, relative (ntile) buckets reshuffle every import, which makes
-- "champion this week / at_risk next week" noise rather than signal.
-- Thresholds per design §2.4 (AOV reference: LINE ~1,626 THB, TikTok ~489 THB):
--   Recency (days since last order): <30 = 3 · 30-90 = 2 · >90 = 1
--   Frequency (order_count):          1 = 1 · 2-3   = 2 · 4+  = 3
--   Monetary (revenue_sum):         <500 = 1 · 500-1500 = 2 · >1500 = 3
-- Segment mapping is deliberately a small readable rule set (not all 27
-- R/F/M score combinations) per architect's explicit "ไม่ต้อง 125 ช่อง":
--   no_orders -> master customer row with zero fact_order rows (e.g. name-only
--                row with no matching order, or edge case in transform)
--   at_risk   -> silent >90 days (design's explicit definition), regardless of
--                how valuable they used to be — checked before champion/loyal
--                on purpose so a lapsed big spender doesn't stay mislabeled
--   champion  -> bought recently, often, and high value (r=3, f=3, m=3)
--   loyal     -> recent-ish and repeat buyer, not (yet) top-tier value
--   new       -> single order, but recent (not enough history for anything else)
--   standard  -> everyone else (recent-ish, low frequency/value)
create or replace view analytics.v_rfm_segment
  with (security_invoker = true) as
select
  cm.customer_id,
  cm.shop_id,
  cm.display_name,
  cm.order_count as frequency,
  cm.revenue_sum as monetary,
  cm.last_order_at,
  case when cm.last_order_at is null then null
    else extract(day from (now() - cm.last_order_at::timestamptz))::int
  end as recency_days,
  case
    when cm.last_order_at is null then null
    when now() - cm.last_order_at::timestamptz < interval '30 days' then 3
    when now() - cm.last_order_at::timestamptz <= interval '90 days' then 2
    else 1
  end as r_score,
  case
    when cm.order_count <= 0 then null
    when cm.order_count = 1 then 1
    when cm.order_count between 2 and 3 then 2
    else 3
  end as f_score,
  case
    when cm.order_count <= 0 then null
    when cm.revenue_sum < 500 then 1
    when cm.revenue_sum <= 1500 then 2
    else 3
  end as m_score,
  case
    when cm.order_count <= 0 or cm.last_order_at is null then 'no_orders'
    when now() - cm.last_order_at::timestamptz > interval '90 days' then 'at_risk'
    when now() - cm.last_order_at::timestamptz < interval '30 days'
      and cm.order_count >= 4
      and cm.revenue_sum > 1500 then 'champion'
    when now() - cm.last_order_at::timestamptz <= interval '90 days'
      and cm.order_count >= 2 then 'loyal'
    when cm.order_count = 1
      and now() - cm.last_order_at::timestamptz < interval '30 days' then 'new'
    else 'standard'
  end as segment
from analytics.v_customer_master cm;

-- v_customer_ltv — revenue-LTV is the primary number (Decision Q3 default,
-- "reliable today"); profit_sum is carried alongside but is ALWAYS an
-- estimate right now — every UI showing it must render the
-- "ประมาณการ 20%" label, do not present profit_sum as a fact.
create or replace view analytics.v_customer_ltv
  with (security_invoker = true) as
select
  cm.customer_id,
  cm.shop_id,
  cm.display_name,
  cm.order_count,
  cm.revenue_sum,
  case when cm.order_count > 0 then round(cm.revenue_sum / cm.order_count, 2) else null end as aov,
  cm.profit_sum, -- ESTIMATE ONLY: 20% of revenue placeholder, no real COGS yet
  dch.code as first_touch_channel,
  cm.first_order_at,
  cm.last_order_at
from analytics.v_customer_master cm
left join analytics.dim_channel dch on dch.id = cm.first_touch_channel_id;

-- v_channel_perf_monthly — revenue/orders/AOV/new_customers per calendar
-- month x channel. No spend/ROAS/CAC yet — fact_ad_spend is empty until B3
-- (Decision Q5, owner still needs to commit to entering it weekly); the UI
-- must render "ไม่มีข้อมูล ad spend" rather than fabricate a ROAS number.
create or replace view analytics.v_channel_perf_monthly
  with (security_invoker = true) as
select
  v.shop_id,
  date_trunc('month', v.order_date)::date as month,
  dch.code as channel_code,
  dch.name as channel_name,
  count(*) as orders,
  sum(v.revenue) as revenue,
  round(sum(v.revenue) / count(*), 2) as aov,
  count(*) filter (where v.is_new_customer) as new_customers
from analytics.v_fact_order v
join analytics.dim_channel dch on dch.id = v.channel_id
group by v.shop_id, date_trunc('month', v.order_date), dch.code, dch.name;

-- v_import_error_summary — count of staging rows per batch x error_code, for
-- /crm/import-errors to group on instead of parsing error_detail prose.
-- error_code is null for rows still pending/never errored — excluded here,
-- this view only exists to summarize actual errors.
create or replace view analytics.v_import_error_summary
  with (security_invoker = true) as
select
  b.id as batch_id,
  b.shop_id,
  b.file_name,
  b.imported_at,
  s.error_code,
  count(*) as error_count
from analytics.stg_order_import s
join analytics.stg_import_batch b on b.id = s.batch_id
where s.import_status = 'error'
  and s.error_code is not null
group by b.id, b.shop_id, b.file_name, b.imported_at, s.error_code;

-- ============================================================================
-- 4. Grants — 0018 granted `select on all tables in schema analytics` to
-- authenticated at the time it ran; that grant does NOT retroactively cover
-- views created afterwards, so re-run it here to cover the six views above.
-- Actual row-level filtering still comes from RLS on the underlying tables
-- (these are invoker-security views) — this grant only clears the outer
-- "can you touch this relation at all" gate.
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;
