-- 0037_hero_stock_watch.sql
-- Hero-SKU live stock counter + low-stock alert (COO 9.9 ops-plan-99.md §1).
-- The owner marks the 3-5 hero SKUs they'll push in a live; the counter page
-- shows realtime available (on_hand - reserved) with a per-SKU alert threshold,
-- so the host stops selling before oversell (the origin problem of this OMS).
-- Reads public.central_stock (kept live by the reserve/commit/release RPCs).

-- ============================================================================
-- 1. hero_watch — which SKUs to watch this campaign + their alert threshold.
-- ============================================================================

create table analytics.hero_watch (
  shop_id uuid not null references public.shop (id) on delete cascade,
  product_id uuid not null references public.product (id) on delete cascade,
  low_stock_threshold int not null default 3 check (low_stock_threshold >= 0),
  note text,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (shop_id, product_id)
);

alter table analytics.hero_watch enable row level security;

create policy tenant_isolation_select on analytics.hero_watch
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

create policy owner_admin_insert on analytics.hero_watch
  for insert
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_update on analytics.hero_watch
  for update
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_delete on analytics.hero_watch
  for delete
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 2. v_hero_stock — the live counter. available = on_hand - reserved; is_low /
--    is_out drive the amber/red states on the page. security_invoker. LEFT JOIN
--    central_stock so a watched product with no stock row reads available 0
--    (correctly "out"), not disappears.
-- ============================================================================

create or replace view analytics.v_hero_stock
  with (security_invoker = true) as
select
  hw.shop_id,
  hw.product_id,
  p.sku,
  p.name,
  p.is_active,
  coalesce(cs.qty_on_hand, 0) as qty_on_hand,
  coalesce(cs.qty_reserved, 0) as qty_reserved,
  coalesce(cs.qty_on_hand, 0) - coalesce(cs.qty_reserved, 0) as available,
  hw.low_stock_threshold,
  (coalesce(cs.qty_on_hand, 0) - coalesce(cs.qty_reserved, 0)) <= 0 as is_out,
  (coalesce(cs.qty_on_hand, 0) - coalesce(cs.qty_reserved, 0)) <= hw.low_stock_threshold as is_low,
  hw.note,
  cs.updated_at as stock_updated_at,
  hw.added_at
from analytics.hero_watch hw
join public.product p on p.id = hw.product_id
left join public.central_stock cs on cs.product_id = hw.product_id and cs.shop_id = hw.shop_id;

-- ============================================================================
-- 3. RPCs (SECURITY DEFINER + crm_require_owner_admin gate) — add / remove.
--    add verifies the product belongs to the shop (IDOR guard) so a caller
--    can't watch another shop's product.
-- ============================================================================

create or replace function analytics.hero_watch_add(
  p_shop_id uuid,
  p_product_id uuid,
  p_low_stock_threshold int default 3,
  p_note text default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_shop_id is null or p_product_id is null then
    raise exception 'hero_watch_add: p_shop_id and p_product_id are required';
  end if;
  if p_low_stock_threshold is null or p_low_stock_threshold < 0 then
    raise exception 'hero_watch_add: p_low_stock_threshold must be >= 0';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  -- IDOR guard: product must belong to this shop
  if not exists (select 1 from public.product where id = p_product_id and shop_id = p_shop_id) then
    raise exception 'hero_watch_add: product % not found in shop', p_product_id using errcode = 'P0002';
  end if;

  insert into analytics.hero_watch (shop_id, product_id, low_stock_threshold, note, added_by)
  values (p_shop_id, p_product_id, p_low_stock_threshold, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (shop_id, product_id) do update set
    low_stock_threshold = excluded.low_stock_threshold,
    note = excluded.note;
end;
$$;

revoke execute on function analytics.hero_watch_add(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function analytics.hero_watch_add(uuid, uuid, int, text) to authenticated, service_role;

create or replace function analytics.hero_watch_remove(
  p_shop_id uuid,
  p_product_id uuid
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_shop_id is null or p_product_id is null then
    raise exception 'hero_watch_remove: p_shop_id and p_product_id are required';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  delete from analytics.hero_watch where shop_id = p_shop_id and product_id = p_product_id;
end;
$$;

revoke execute on function analytics.hero_watch_remove(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.hero_watch_remove(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 4. Grants — cover the new table + view.
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
