-- 0028_sku_cost_margin.sql
-- Phase C1a — SKU cost master + blended margin + ROAS target
--   docs/3j-jewelry/analytics/phase-c1-sku-cost-margin.md
--
-- Decisions (owner, 2026-08-12):
--   D1 blended margin first — product master -> blended margin % -> replace the
--      literal 0.20 in v_fact_order + v_channel_perf_roas. (No per-SKU order
--      linkage yet: fact_order_item is empty, so a single per-shop blended
--      margin is the only honest option today. Per-SKU margin waits for the
--      line-item import phase.)
--   D2 two cost modes — 'fixed' (jewelry, manual unit_cost) and 'spot' (silver
--      bars: weight x silver spot x purity + labor).
--   D3 ROAS target = ad-share-of-gross-profit: target = 1/(margin x ad_share);
--      break-even = 1/margin.
--
-- Scope note: the transform proc (0020/21/26) writes fo.profit = revenue*0.20 at
-- import, but v_fact_order RE-computes profit for every 'estimated' row at read
-- time (overriding the stored value). So wiring blended margin only needs the
-- two READ views changed — the transform proc is deliberately left untouched.

-- ============================================================================
-- 1. Extend public.product (master). unit_cost/sku/name/barcode/is_active exist.
-- ============================================================================

alter table public.product
  add column if not exists category        text,
  add column if not exists cost_type       text not null default 'fixed',
  add column if not exists silver_weight_g numeric(10, 3),
  add column if not exists silver_purity   numeric(5, 4),
  add column if not exists labor_cost      numeric(12, 2),
  add column if not exists list_price      numeric(12, 2),
  add column if not exists supplier        text,
  add column if not exists note            text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_cost_type_check') then
    alter table public.product add constraint product_cost_type_check
      check (cost_type in ('fixed', 'spot'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_silver_weight_check') then
    alter table public.product add constraint product_silver_weight_check
      check (silver_weight_g is null or silver_weight_g >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_silver_purity_check') then
    alter table public.product add constraint product_silver_purity_check
      check (silver_purity is null or (silver_purity > 0 and silver_purity <= 1));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_labor_cost_check') then
    alter table public.product add constraint product_labor_cost_check
      check (labor_cost is null or labor_cost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_list_price_check') then
    alter table public.product add constraint product_list_price_check
      check (list_price is null or list_price >= 0);
  end if;
end $$;

-- ============================================================================
-- 2. analytics.shop_setting — per-shop pricing/margin knobs.
--    Writes go through shop_setting_upsert (SECURITY DEFINER) only; RLS policies
--    exist for defense-in-depth but no table-level DML grant to authenticated.
-- ============================================================================

create table if not exists analytics.shop_setting (
  shop_id uuid primary key references public.shop (id) on delete cascade,
  silver_spot_thb_per_gram numeric(12, 4) check (silver_spot_thb_per_gram is null or silver_spot_thb_per_gram >= 0),
  silver_spot_updated_at   timestamptz,
  blended_margin_pct numeric(5, 4) not null default 0.20 check (blended_margin_pct > 0 and blended_margin_pct < 1),
  target_ad_gp_share numeric(5, 4) not null default 0.50 check (target_ad_gp_share > 0 and target_ad_gp_share <= 1),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table analytics.shop_setting enable row level security;

drop policy if exists tenant_isolation_select on analytics.shop_setting;
create policy tenant_isolation_select on analytics.shop_setting
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

drop policy if exists owner_admin_insert on analytics.shop_setting;
create policy owner_admin_insert on analytics.shop_setting
  for insert
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

drop policy if exists owner_admin_update on analytics.shop_setting;
create policy owner_admin_update on analytics.shop_setting
  for update
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- seed default row for every existing shop
insert into analytics.shop_setting (shop_id, blended_margin_pct, target_ad_gp_share)
select id, 0.20, 0.50 from public.shop
on conflict (shop_id) do nothing;

-- ============================================================================
-- 3. v_dim_product — effective cost (fixed vs spot) + margin_pct.
--    Keeps the original 9 columns (product_id, shop_id, sku, name, unit_cost,
--    is_active, category, created_at, updated_at) in order for create-or-replace
--    compatibility; `unit_cost` now carries the EFFECTIVE cost (backward-compat),
--    with the raw manual value re-exposed as `manual_unit_cost`.
-- ============================================================================

create or replace view analytics.v_dim_product
  with (security_invoker = true) as
select
  p.id as product_id,
  p.shop_id,
  p.sku,
  p.name,
  (case p.cost_type
    when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                            * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
    else p.unit_cost
  end)::numeric(12, 2) as unit_cost,
  p.is_active,
  p.category,
  p.created_at,
  p.updated_at,
  p.cost_type,
  p.silver_weight_g,
  coalesce(p.silver_purity, 0.925) as silver_purity,
  p.labor_cost,
  p.list_price,
  p.unit_cost as manual_unit_cost,
  (case p.cost_type
    when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                            * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
    else p.unit_cost
  end)::numeric(12, 2) as effective_unit_cost,
  case
    when p.list_price is not null and p.list_price > 0 then
      round((p.list_price - (case p.cost_type
        when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                                * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
        else p.unit_cost end)) / p.list_price, 4)
    else null
  end as margin_pct
from public.product p
left join analytics.shop_setting s on s.shop_id = p.shop_id;

-- ============================================================================
-- 4. v_blended_margin_suggestion — avg margin of active priced products, for
--    the settings-screen helper (owner still sets the number manually).
-- ============================================================================

create or replace view analytics.v_blended_margin_suggestion
  with (security_invoker = true) as
select
  shop_id,
  count(*) filter (where margin_pct is not null) as products_with_margin,
  round(avg(margin_pct) filter (where margin_pct is not null), 4) as suggested_margin_pct
from analytics.v_dim_product
where is_active
group by shop_id;

-- ============================================================================
-- 5. v_fact_order — replace literal 0.20 with per-shop blended_margin_pct.
--    Identical column set/order to the prior version (only the profit expression
--    changed) so all dependent views stay valid. security_invoker preserved.
-- ============================================================================

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
              * coalesce((select ss.blended_margin_pct from analytics.shop_setting ss
                          where ss.shop_id = fo.shop_id), 0.20), 2)::numeric(12,2)
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
     left join analytics.crm_order_override ov on ov.fact_order_id = fo.id;

-- ============================================================================
-- 6. v_channel_perf_roas — blended margin for profit_roas + append
--    break_even_roas / target_roas (appended at end for create-or-replace).
-- ============================================================================

create or replace view analytics.v_channel_perf_roas
  with (security_invoker = true) as
with orders_agg as (
  select
    v.shop_id,
    date_trunc('month', v.order_date)::date as month,
    v.channel_id,
    count(*) as orders,
    sum(v.revenue) as revenue,
    count(*) filter (where v.is_new_customer) as new_customers
  from analytics.v_fact_order v
  group by v.shop_id, date_trunc('month', v.order_date), v.channel_id
),
spend_agg as (
  select
    fa.shop_id,
    date_trunc('month', fa.spend_date)::date as month,
    fa.channel_id,
    sum(fa.spend_amount) as spend
  from analytics.fact_ad_spend fa
  group by fa.shop_id, date_trunc('month', fa.spend_date), fa.channel_id
),
combined as (
  select
    coalesce(o.shop_id, s.shop_id) as shop_id,
    coalesce(o.month, s.month) as month,
    coalesce(o.channel_id, s.channel_id) as channel_id,
    coalesce(o.orders, 0) as orders,
    coalesce(o.revenue, 0) as revenue,
    coalesce(o.new_customers, 0) as new_customers,
    s.spend as spend
  from orders_agg o
  full outer join spend_agg s
    on s.shop_id = o.shop_id and s.month = o.month and s.channel_id = o.channel_id
)
select
  c.shop_id,
  c.month,
  dch.code as channel_code,
  dch.name as channel_name,
  c.orders,
  c.revenue,
  case when c.orders > 0 then round(c.revenue / c.orders, 2) else null end as aov,
  c.new_customers,
  c.spend,
  case when c.spend is not null and c.spend <> 0 then round(c.revenue / c.spend, 2) else null end as roas,
  -- profit_roas now uses the per-shop blended margin (was literal 0.20)
  case when c.spend is not null and c.spend <> 0
    then round((c.revenue * coalesce(ss.blended_margin_pct, 0.20)) / c.spend, 2) else null end as profit_roas,
  case when c.spend is not null and c.new_customers <> 0
    then round(c.spend / c.new_customers, 2) else null end as cac,
  -- break-even ROAS = 1/margin ; target ROAS = 1/(margin x ad_gp_share). Both
  -- independent of spend so they render even for months with no spend entered.
  round(1.0 / coalesce(ss.blended_margin_pct, 0.20), 2) as break_even_roas,
  round(1.0 / (coalesce(ss.blended_margin_pct, 0.20) * coalesce(ss.target_ad_gp_share, 0.50)), 2) as target_roas
from combined c
join analytics.dim_channel dch on dch.id = c.channel_id
left join analytics.shop_setting ss on ss.shop_id = c.shop_id;

-- ============================================================================
-- 7. RPCs (SECURITY DEFINER + crm_require_owner_admin gate) — product master
--    edit + shop settings edit. Same auth pattern as the crm_*/mkt_* RPCs.
-- ============================================================================

create or replace function analytics.product_upsert(
  p_shop_id uuid,
  p_sku text,
  p_name text,
  p_category text default null,
  p_cost_type text default 'fixed',
  p_unit_cost numeric default null,
  p_silver_weight_g numeric default null,
  p_silver_purity numeric default null,
  p_labor_cost numeric default null,
  p_list_price numeric default null,
  p_barcode text default null,
  p_supplier text default null,
  p_note text default null,
  p_is_active boolean default true
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  if p_shop_id is null or p_sku is null or btrim(p_sku) = '' or p_name is null or btrim(p_name) = '' then
    raise exception 'product_upsert: p_shop_id, p_sku, p_name are required';
  end if;
  if p_cost_type not in ('fixed', 'spot') then
    raise exception 'product_upsert: p_cost_type must be fixed or spot';
  end if;
  if p_cost_type = 'spot' and (p_silver_weight_g is null or p_silver_weight_g <= 0) then
    raise exception 'product_upsert: spot cost requires silver_weight_g > 0';
  end if;
  if p_silver_purity is not null and (p_silver_purity <= 0 or p_silver_purity > 1) then
    raise exception 'product_upsert: p_silver_purity must be in (0,1]';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  insert into public.product (
    shop_id, sku, name, category, cost_type, unit_cost, silver_weight_g,
    silver_purity, labor_cost, list_price, barcode, supplier, note, is_active
  ) values (
    p_shop_id, btrim(p_sku), btrim(p_name), p_category, p_cost_type, p_unit_cost, p_silver_weight_g,
    p_silver_purity, p_labor_cost, p_list_price, p_barcode, p_supplier, p_note, coalesce(p_is_active, true)
  )
  on conflict (shop_id, sku) do update set
    name = excluded.name,
    category = excluded.category,
    cost_type = excluded.cost_type,
    unit_cost = excluded.unit_cost,
    silver_weight_g = excluded.silver_weight_g,
    silver_purity = excluded.silver_purity,
    labor_cost = excluded.labor_cost,
    list_price = excluded.list_price,
    barcode = excluded.barcode,
    supplier = excluded.supplier,
    note = excluded.note,
    is_active = excluded.is_active,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean)
  to authenticated, service_role;

create or replace function analytics.shop_setting_upsert(
  p_shop_id uuid,
  p_silver_spot_thb_per_gram numeric default null,
  p_blended_margin_pct numeric default null,
  p_target_ad_gp_share numeric default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_shop_id is null then
    raise exception 'shop_setting_upsert: p_shop_id is required';
  end if;
  if p_blended_margin_pct is not null and (p_blended_margin_pct <= 0 or p_blended_margin_pct >= 1) then
    raise exception 'shop_setting_upsert: p_blended_margin_pct must be in (0,1)';
  end if;
  if p_target_ad_gp_share is not null and (p_target_ad_gp_share <= 0 or p_target_ad_gp_share > 1) then
    raise exception 'shop_setting_upsert: p_target_ad_gp_share must be in (0,1]';
  end if;
  if p_silver_spot_thb_per_gram is not null and p_silver_spot_thb_per_gram < 0 then
    raise exception 'shop_setting_upsert: p_silver_spot_thb_per_gram must be >= 0';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  insert into analytics.shop_setting as ss (
    shop_id, silver_spot_thb_per_gram, silver_spot_updated_at,
    blended_margin_pct, target_ad_gp_share, updated_by, updated_at
  ) values (
    p_shop_id, p_silver_spot_thb_per_gram,
    case when p_silver_spot_thb_per_gram is not null then now() else null end,
    coalesce(p_blended_margin_pct, 0.20), coalesce(p_target_ad_gp_share, 0.50), auth.uid(), now()
  )
  on conflict (shop_id) do update set
    silver_spot_thb_per_gram = coalesce(p_silver_spot_thb_per_gram, ss.silver_spot_thb_per_gram),
    silver_spot_updated_at   = case when p_silver_spot_thb_per_gram is not null then now() else ss.silver_spot_updated_at end,
    blended_margin_pct       = coalesce(p_blended_margin_pct, ss.blended_margin_pct),
    target_ad_gp_share       = coalesce(p_target_ad_gp_share, ss.target_ad_gp_share),
    updated_by               = auth.uid(),
    updated_at               = now();
end;
$$;

revoke execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric)
  to authenticated, service_role;

-- ============================================================================
-- 8. Grants — cover the new shop_setting table + v_blended_margin_suggestion.
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
