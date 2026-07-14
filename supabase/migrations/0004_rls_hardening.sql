-- 0004_rls_hardening.sql
-- Security-auditor findings from the Phase 2 batch-1 review (H3, M2, L2).
-- Does NOT edit 0001/0002 in place (those may already be applied) — every
-- change here is either `drop policy if exists` + `create policy`, or
-- `create or replace function`, both of which are safe to layer on top of an
-- already-applied migration.

-- ============================================================================
-- H3a — central_stock: writes must ONLY happen through the SECURITY DEFINER
-- RPCs in 0003 (reserve_stock/commit_stock/release_stock) or the new
-- adjust_stock() RPC below (0005). Direct end-user writes bypassed the
-- stock_ledger audit trail entirely — that's the exact "ledger bypass" this
-- closes. `for all` -> select-only.
-- ============================================================================

drop policy if exists tenant_isolation on central_stock;

create policy tenant_isolation_select on central_stock
  for select
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

-- ============================================================================
-- H3b — orders / order_item / shipment: these are only ever written by
-- trusted server-side code (sync-worker's direct Postgres connection using
-- the service role, or the webhook route's service-role Supabase client) —
-- there is no legitimate end-user-initiated direct write path in this batch.
-- `for all` -> select-only, matching the design note "เกิดจาก worker/service
-- role อยู่แล้ว". See report for the follow-up this implies (any future
-- "seller manually creates a shipment" UI action needs its own service-role
-- backed API route/RPC — not just an RLS-permitted client-side insert).
-- ============================================================================

drop policy if exists tenant_isolation on orders;

create policy tenant_isolation_select on orders
  for select
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

drop policy if exists tenant_isolation on order_item;

create policy tenant_isolation_select on order_item
  for select
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

drop policy if exists tenant_isolation on shipment;

create policy tenant_isolation_select on shipment
  for select
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

-- ============================================================================
-- M2 — channel_account: the enum shop_member_role (owner/admin/staff) existed
-- but no policy consulted it. `credential_ref` is the single most sensitive
-- column in the whole schema (points at the Vault secret) — restrict both
-- writing the row at all, and reading/writing that column specifically, to
-- owner/admin.
--
-- DECISION: mutation of the *whole* channel_account row (not just
-- credential_ref) is restricted to owner/admin. RLS is row-level, not
-- column-level, so there is no way to let 'staff' update e.g.
-- reserve_ttl_hours while blocking them from updating credential_ref via a
-- row policy alone — the column-level REVOKE below is what actually protects
-- credential_ref specifically. Requiring owner/admin for the whole row is a
-- deliberate, safer default (channel connection config is an
-- owner/admin-level concern in most shops); flagged here since it's stricter
-- than the literal M2 ask.
-- ============================================================================

drop policy if exists tenant_isolation on channel_account;

create policy tenant_isolation_select on channel_account
  for select
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()));

create policy owner_admin_insert on channel_account
  for insert
  with check (
    shop_id in (
      select shop_id from shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_update on channel_account
  for update
  using (
    shop_id in (
      select shop_id from shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    shop_id in (
      select shop_id from shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_delete on channel_account
  for delete
  using (
    shop_id in (
      select shop_id from shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- Column-level protection for credential_ref (defense-in-depth beyond the row
-- policy above): even an owner/admin querying `select *` cannot read it back
-- directly through PostgREST anymore — they must go through the
-- SECURITY DEFINER function below, which re-checks role membership itself.
-- NOTE (app-layer impact): any existing client code doing
-- `.from('channel_account').select('*')` will now get a permission-denied
-- error for that one column and must select explicit column lists instead
-- (excluding credential_ref) — flagged in the report as a required follow-up
-- for whichever batch builds the channel_account UI/API.
revoke select (credential_ref), update (credential_ref) on channel_account from authenticated, anon;

create or replace function reveal_channel_account_credential_ref(p_channel_account_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop_id uuid;
  v_credential_ref text;
  v_is_privileged boolean;
begin
  if p_channel_account_id is null then
    raise exception 'reveal_channel_account_credential_ref: p_channel_account_id is required';
  end if;

  select shop_id, credential_ref into v_shop_id, v_credential_ref
    from channel_account
    where id = p_channel_account_id;

  if v_shop_id is null then
    raise exception 'reveal_channel_account_credential_ref: channel_account % not found', p_channel_account_id;
  end if;

  select exists(
    select 1 from shop_member
    where shop_id = v_shop_id and user_id = auth.uid() and role in ('owner', 'admin')
  ) into v_is_privileged;

  if not v_is_privileged then
    -- Same error regardless of "not a member" vs "member but staff" — avoids
    -- leaking which shops the caller belongs to.
    raise exception 'reveal_channel_account_credential_ref: forbidden' using errcode = '42501';
  end if;

  return v_credential_ref;
end;
$$;

revoke all on function reveal_channel_account_credential_ref(uuid) from public;
grant execute on function reveal_channel_account_credential_ref(uuid) to authenticated;

-- ============================================================================
-- L2 — SET search_path = public, pg_temp for the 0001 trigger helper
-- functions that were missing it (all four 0003 RPCs already had it; the
-- shared `set_updated_at` + per-table shop_id-sync trigger functions in 0001
-- did not). Without a pinned search_path, a SECURITY DEFINER/trigger function
-- run as table owner is vulnerable to a search_path hijack if a malicious
-- schema is ever added ahead of `public` for the owning role. These are
-- `create or replace function` with identical bodies to 0001 — safe to layer
-- on top of an already-applied migration, no DROP required since the
-- signatures are unchanged.
-- ============================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function sync_product_mapping_shop_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_product_shop_id uuid;
  v_account_shop_id uuid;
begin
  select shop_id into v_product_shop_id from product where id = new.product_id;
  select shop_id into v_account_shop_id from channel_account where id = new.channel_account_id;

  if v_product_shop_id is null then
    raise exception 'product_mapping: product % not found', new.product_id;
  end if;
  if v_account_shop_id is null then
    raise exception 'product_mapping: channel_account % not found', new.channel_account_id;
  end if;
  if v_product_shop_id <> v_account_shop_id then
    raise exception
      'product_mapping: product % (shop %) and channel_account % (shop %) belong to different shops',
      new.product_id, v_product_shop_id, new.channel_account_id, v_account_shop_id;
  end if;

  new.shop_id := v_product_shop_id;
  return new;
end;
$$;

create or replace function sync_central_stock_shop_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_shop_id uuid;
begin
  select shop_id into v_shop_id from product where id = new.product_id;
  if v_shop_id is null then
    raise exception 'central_stock: product % not found', new.product_id;
  end if;
  new.shop_id := v_shop_id;
  return new;
end;
$$;

create or replace function sync_orders_shop_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_shop_id uuid;
begin
  select shop_id into v_shop_id from channel_account where id = new.channel_account_id;
  if v_shop_id is null then
    raise exception 'orders: channel_account % not found', new.channel_account_id;
  end if;
  new.shop_id := v_shop_id;
  return new;
end;
$$;

create or replace function validate_order_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_allowed := case old.status
    when 'new' then new.status in ('confirmed', 'oversold_hold', 'cancelled')
    when 'confirmed' then new.status in ('to_ship', 'cancelled')
    when 'to_ship' then new.status in ('shipped', 'cancelled')
    when 'shipped' then new.status in ('completed')
    when 'oversold_hold' then new.status in ('new', 'cancelled')
    when 'completed' then false
    when 'cancelled' then false
    else false
  end;

  if not v_allowed then
    raise exception 'orders: invalid status transition % -> % for order %', old.status, new.status, old.id
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create or replace function sync_order_item_shop_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_shop_id uuid;
begin
  select shop_id into v_shop_id from orders where id = new.order_id;
  if v_shop_id is null then
    raise exception 'order_item: order % not found', new.order_id;
  end if;
  new.shop_id := v_shop_id;
  return new;
end;
$$;

create or replace function sync_shipment_shop_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_shop_id uuid;
begin
  select shop_id into v_shop_id from orders where id = new.order_id;
  if v_shop_id is null then
    raise exception 'shipment: order % not found', new.order_id;
  end if;
  new.shop_id := v_shop_id;
  return new;
end;
$$;
