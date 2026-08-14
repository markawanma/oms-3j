-- 0031_catalog_management.sql
-- Phase C1f — catalog management: change log, delete (add/edit/delete flag),
-- and a dormant "SKU sold while inactive/unknown" alert.
--
-- Owner decisions (2026-08-13):
--   - delete = HARD delete only when the SKU has no order/stock references;
--     otherwise block and tell the owner to disable (is_active=false) instead.
--   - build the inactive/unknown-SKU-order alert now as a DORMANT view (fires
--     once analytics.fact_order_item has line-items; empty today).
--   - CSV `action` column: add/edit/blank => upsert, delete => delete.
--   - every add/edit/delete writes analytics.catalog_audit_log (before/after).

-- ============================================================================
-- 1. catalog_audit_log — every product change. Written only by the SECURITY
--    DEFINER RPCs below (no direct DML grant); tenant-scoped SELECT.
-- ============================================================================

create table if not exists analytics.catalog_audit_log (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shop (id) on delete cascade,
  product_id uuid,                       -- null after a hard delete
  sku text not null,
  action text not null check (action in ('add', 'edit', 'delete')),
  before jsonb,                          -- null for add
  after jsonb,                           -- null for delete
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_catalog_audit_shop_time
  on analytics.catalog_audit_log (shop_id, changed_at desc);

alter table analytics.catalog_audit_log enable row level security;

drop policy if exists tenant_isolation_select on analytics.catalog_audit_log;
create policy tenant_isolation_select on analytics.catalog_audit_log
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- ============================================================================
-- 2. product_upsert — now snapshots before/after into catalog_audit_log and
--    records whether the row was added or edited. Same signature (grants
--    preserved), keeps the 0029 non-negative guards.
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
  v_old public.product;
  v_new public.product;
  v_action text;
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

  select * into v_old from public.product where shop_id = p_shop_id and sku = btrim(p_sku);
  v_action := case when v_old.id is null then 'add' else 'edit' end;

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
  returning * into v_new;

  insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
  values (
    p_shop_id, v_new.id, v_new.sku, v_action,
    case when v_old.id is null then null else to_jsonb(v_old) end,
    to_jsonb(v_new), auth.uid()
  );

  return v_new.id;
end;
$$;

-- ============================================================================
-- 3. product_delete — hard delete only when the SKU has no order/stock refs;
--    otherwise raise (owner should disable instead). Logs a 'delete' row.
-- ============================================================================

create or replace function analytics.product_delete(
  p_shop_id uuid,
  p_sku text
)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_old public.product;
  v_refs bigint;
begin
  if p_shop_id is null or p_sku is null or btrim(p_sku) = '' then
    raise exception 'product_delete: p_shop_id and p_sku are required';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_old from public.product where shop_id = p_shop_id and sku = btrim(p_sku);
  if v_old.id is null then
    raise exception 'product_delete: ไม่พบ SKU %', p_sku using errcode = 'P0002';
  end if;

  -- any order/stock linkage blocks a hard delete (data would orphan / FK error)
  select
      (select count(*) from analytics.fact_order_item where product_id = v_old.id)
    + (select count(*) from public.order_item where product_id = v_old.id)
    + (select count(*) from public.central_stock where product_id = v_old.id)
    + (select count(*) from public.stock_ledger where product_id = v_old.id)
    + (select count(*) from public.product_mapping where product_id = v_old.id)
  into v_refs;

  if v_refs > 0 then
    raise exception 'ลบไม่ได้: SKU % มีข้อมูลผูกอยู่ (ออเดอร์/สต็อก) % รายการ — ใช้ปิดการใช้งาน (is_active=false) แทน', p_sku, v_refs
      using errcode = 'P0001';
  end if;

  delete from public.product where id = v_old.id;

  insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
  values (p_shop_id, null, v_old.sku, 'delete', to_jsonb(v_old), null, auth.uid());

  return 'deleted';
end;
$$;

revoke execute on function analytics.product_delete(uuid, text) from public, anon, authenticated;
grant execute on function analytics.product_delete(uuid, text) to authenticated, service_role;

-- ============================================================================
-- 4. product_upsert_bulk — honour the per-row `action` column: 'delete' routes
--    to product_delete, everything else (add/edit/blank) to product_upsert.
--    Per-row subtransaction keeps partial-success semantics.
-- ============================================================================

create or replace function analytics.product_upsert_bulk(
  p_shop_id uuid,
  p_rows jsonb
)
 returns table(row_index int, sku text, status text, error text)
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  r jsonb;
  i int := 0;
  v_sku text;
  v_action text;
  v_active boolean;
begin
  if p_shop_id is null then
    raise exception 'product_upsert_bulk: p_shop_id is required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'product_upsert_bulk: p_rows must be a json array';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  for r in select * from jsonb_array_elements(p_rows)
  loop
    i := i + 1;
    v_sku := btrim(coalesce(r ->> 'sku', ''));
    v_action := lower(btrim(coalesce(r ->> 'action', '')));
    begin
      if v_action = 'delete' then
        perform analytics.product_delete(p_shop_id, v_sku);
        row_index := i; sku := v_sku; status := 'deleted'; error := null;
      else
        v_active := case lower(coalesce(nullif(btrim(r ->> 'is_active'), ''), 'true'))
                      when 'false' then false when '0' then false when 'no' then false else true end;
        perform analytics.product_upsert(
          p_shop_id,
          v_sku,
          r ->> 'name',
          nullif(btrim(coalesce(r ->> 'category', '')), ''),
          coalesce(nullif(btrim(r ->> 'cost_type'), ''), 'fixed'),
          nullif(btrim(coalesce(r ->> 'unit_cost', '')), '')::numeric,
          nullif(btrim(coalesce(r ->> 'silver_weight_g', '')), '')::numeric,
          nullif(btrim(coalesce(r ->> 'silver_purity', '')), '')::numeric,
          nullif(btrim(coalesce(r ->> 'labor_cost', '')), '')::numeric,
          nullif(btrim(coalesce(r ->> 'list_price', '')), '')::numeric,
          nullif(btrim(coalesce(r ->> 'barcode', '')), ''),
          nullif(btrim(coalesce(r ->> 'supplier', '')), ''),
          nullif(btrim(coalesce(r ->> 'note', '')), ''),
          v_active
        );
        row_index := i; sku := v_sku; status := 'ok'; error := null;
      end if;
      return next;
    exception when others then
      row_index := i; sku := v_sku; status := 'error'; error := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

-- ============================================================================
-- 5. v_sku_order_alert — DORMANT until fact_order_item has line-items. Flags a
--    SKU that appears in an order while it is inactive, or that has no product
--    master row at all (unknown SKU from a live). security_invoker.
-- ============================================================================

create or replace view analytics.v_sku_order_alert
  with (security_invoker = true) as
select
  fi.shop_id,
  fi.sku_snapshot as sku,
  fi.product_id,
  case when fi.product_id is null then 'unknown' else 'inactive' end as reason,
  count(*) as line_count,
  sum(fi.qty) as qty_sold,
  max(fo.order_date) as last_order_date
from analytics.fact_order_item fi
join analytics.fact_order fo on fo.id = fi.fact_order_id
left join public.product p on p.id = fi.product_id
where fi.product_id is null
   or p.is_active = false
group by fi.shop_id, fi.sku_snapshot, fi.product_id,
         case when fi.product_id is null then 'unknown' else 'inactive' end;

-- ============================================================================
-- 6. Grants — cover the new audit table + alert view.
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
