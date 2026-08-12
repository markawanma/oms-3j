-- 0029_product_upsert_unit_cost_guard.sql
-- Security-audit L2 (Phase C1 review): product_upsert validated purity/weight
-- in-function but relied solely on the public.product `unit_cost >= 0` CHECK
-- (0001) for the cost floor. Add an explicit in-function guard for defense-in-
-- depth + a clearer error message, consistent with the other field checks.
--
-- create-or-replace with the IDENTICAL signature — existing revoke/grant on the
-- function are preserved (no need to re-issue them). Only the body changes:
-- one new guard added after the purity check.

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
  -- L2 guard: explicit non-negative check (previously only the column CHECK)
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'product_upsert: p_unit_cost must be >= 0';
  end if;
  if p_labor_cost is not null and p_labor_cost < 0 then
    raise exception 'product_upsert: p_labor_cost must be >= 0';
  end if;
  if p_list_price is not null and p_list_price < 0 then
    raise exception 'product_upsert: p_list_price must be >= 0';
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
