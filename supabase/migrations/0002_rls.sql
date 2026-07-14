-- 0002_rls.sql
-- Row Level Security per docs/phase1-design.md §1: every table with `shop_id`
-- gets a `tenant_isolation` policy shaped as
--   shop_id IN (SELECT shop_id FROM shop_member WHERE user_id = auth.uid())
-- with two named exceptions:
--   - stock_ledger: SELECT-only (writes happen exclusively through the
--     SECURITY DEFINER RPCs in 0003, which run as table owner and bypass RLS).
--   - sync_job: service role only — no policy is granted to `authenticated`/
--     `anon` at all, so RLS (enabled, default-deny) blocks them entirely.
--     Supabase's `service_role` carries BYPASSRLS and is unaffected.

-- ============================================================================
-- shop
-- ============================================================================

alter table shop enable row level security;

create policy tenant_isolation on shop
  for all
  using (id in (select shop_id from shop_member where user_id = auth.uid()))
  with check (id in (select shop_id from shop_member where user_id = auth.uid()));

-- NOTE (assumption): this policy means a brand-new user cannot INSERT the very
-- first `shop` row for themselves (they aren't a shop_member yet — chicken/egg).
-- That's expected: shop provisioning (create shop + first owner shop_member)
-- is a service-role-only onboarding flow, not implemented in this batch.

-- ============================================================================
-- shop_member
-- ============================================================================

alter table shop_member enable row level security;

create policy tenant_isolation on shop_member
  for all
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()))
  with check (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

-- Same bootstrap caveat as `shop`: inviting a NEW member into a shop must go
-- through a service-role invite flow (a user can't grant themselves membership
-- via a self-referential policy on the same table).

-- ============================================================================
-- channel / carrier — shared reference tables, no shop_id.
-- Readable by any authenticated user; writes (adding a new marketplace/carrier)
-- are service-role only (no INSERT/UPDATE/DELETE policy granted here).
-- ============================================================================

alter table channel enable row level security;

create policy read_all on channel
  for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

alter table carrier enable row level security;

create policy read_all on carrier
  for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- ============================================================================
-- channel_account
-- ============================================================================

alter table channel_account enable row level security;

create policy tenant_isolation on channel_account
  for all
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()))
  with check (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

-- ============================================================================
-- product
-- ============================================================================

alter table product enable row level security;

create policy tenant_isolation on product
  for all
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()))
  with check (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

-- ============================================================================
-- product_mapping
-- ============================================================================

alter table product_mapping enable row level security;

create policy tenant_isolation on product_mapping
  for all
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()))
  with check (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

-- ============================================================================
-- central_stock
-- ============================================================================

alter table central_stock enable row level security;

create policy tenant_isolation on central_stock
  for all
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()))
  with check (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

-- ============================================================================
-- stock_ledger — SELECT only for tenant members; no INSERT/UPDATE/DELETE
-- policy is granted, so those are only possible via the SECURITY DEFINER RPCs
-- (reserve_stock / commit_stock / release_stock) or the service role.
-- ============================================================================

alter table stock_ledger enable row level security;

create policy tenant_isolation_select on stock_ledger
  for select
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

-- ============================================================================
-- orders
-- ============================================================================

alter table orders enable row level security;

create policy tenant_isolation on orders
  for all
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()))
  with check (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

-- ============================================================================
-- order_item
-- ============================================================================

alter table order_item enable row level security;

create policy tenant_isolation on order_item
  for all
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()))
  with check (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

-- ============================================================================
-- shipment
-- ============================================================================

alter table shipment enable row level security;

create policy tenant_isolation on shipment
  for all
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()))
  with check (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

-- ============================================================================
-- sync_job — service role only. RLS enabled, zero policies for
-- authenticated/anon => default deny. service_role bypasses RLS (BYPASSRLS).
-- ============================================================================

alter table sync_job enable row level security;
