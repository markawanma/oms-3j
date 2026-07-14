-- 0003_stock_functions.sql
-- Central stock RPCs per docs/phase1-design.md §2.
--
-- SECURITY: all four functions are SECURITY DEFINER (run as table owner,
-- bypassing RLS on stock_ledger/central_stock) — that's exactly what design §1
-- means by "เขียนผ่าน RPC/service role". Because SECURITY DEFINER bypasses RLS,
-- EXECUTE is revoked from PUBLIC/authenticated/anon and granted to
-- `service_role` ONLY. This is a deliberate hardening decision beyond the
-- literal design text: without it, any authenticated end user could call
-- reserve_stock/commit_stock/release_stock with an arbitrary p_shop_id and
-- mutate another tenant's stock, since the definer function itself does not
-- go through RLS. These RPCs are meant to be called from trusted server-side
-- code only (sync-worker, webhook route handler using the service role key).
--
-- IDEMPOTENCY KEY COMPOSITION: the design's literal constraint is
-- `stock_ledger UNIQUE(shop_id, idempotency_key)`. A single order can reserve
-- multiple products in one call (all-or-nothing), which would collide on that
-- constraint if every item in the batch reused the same caller-supplied
-- p_idem_key. Each function composes a per-item key as
-- `p_idem_key || ':' || product_id` before inserting into stock_ledger —
-- this keeps the literal unique constraint from the design intact while
-- making multi-item calls correctly idempotent per product.
--
-- CONCURRENT-DUPLICATE HANDLING: a genuine duplicate call (same idem key,
-- truly concurrent, e.g. two webhook deliveries racing) can still hit a
-- unique_violation on the ledger insert *after* the conditional UPDATE already
-- ran for that iteration. Each item is processed inside its own
-- BEGIN...EXCEPTION block (implicit savepoint) so a unique_violation rolls
-- back only that item's UPDATE and is treated as "already applied" (skip),
-- rather than aborting the whole batch.

-- ============================================================================
-- reserve_stock
-- ============================================================================

create or replace function reserve_stock(
  p_shop_id uuid,
  p_order_id uuid,
  p_idem_key text,
  p_items jsonb -- [{"product_id": "<uuid>", "qty": <int > 0>}, ...]
)
returns table (product_id uuid, qty_on_hand integer, qty_reserved integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
  v_composed_key text;
  v_row central_stock%rowtype;
  v_already boolean;
  v_owner_check uuid;
begin
  if p_shop_id is null or p_order_id is null or p_idem_key is null or trim(p_idem_key) = '' then
    raise exception 'reserve_stock: p_shop_id, p_order_id and p_idem_key are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'reserve_stock: p_items must be a non-empty jsonb array';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_qty := nullif(v_item->>'qty', '')::integer;

    if v_product_id is null then
      raise exception 'reserve_stock: item missing product_id: %', v_item;
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'reserve_stock: qty must be a positive integer for product %: %', v_product_id, v_item;
    end if;

    -- Defense-in-depth: reject cross-tenant product ids even though callers
    -- are trusted server-side code (see EXECUTE grant note above).
    select shop_id into v_owner_check from product where id = v_product_id;
    if v_owner_check is null or v_owner_check <> p_shop_id then
      raise exception 'reserve_stock: product % does not belong to shop %', v_product_id, p_shop_id;
    end if;

    v_composed_key := p_idem_key || ':' || v_product_id::text;

    select exists(
      select 1 from stock_ledger where shop_id = p_shop_id and idempotency_key = v_composed_key
    ) into v_already;

    if v_already then
      continue; -- already applied for this product on a previous attempt — idempotent no-op
    end if;

    begin
      -- Atomic conditional UPDATE (design §2) — 0 rows returned = insufficient stock.
      update central_stock
        set qty_reserved = qty_reserved + v_qty,
            updated_at = now()
        where product_id = v_product_id
          and shop_id = p_shop_id
          and qty_on_hand - qty_reserved >= v_qty
        returning * into v_row;

      if not found then
        raise exception 'reserve_stock: insufficient stock for product % (requested %)', v_product_id, v_qty
          using errcode = 'P0001';
      end if;

      insert into stock_ledger (
        shop_id, product_id, order_id, move_type, qty,
        reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key
      ) values (
        p_shop_id, v_product_id, p_order_id, 'reserve', v_qty,
        v_qty, 0, v_row.qty_on_hand, v_row.qty_reserved, v_composed_key
      );
    exception
      when unique_violation then
        -- Concurrent duplicate call already recorded this exact idem key —
        -- roll back just this item's UPDATE (implicit savepoint) and move on.
        continue;
    end;
  end loop;

  return query
    select cs.product_id, cs.qty_on_hand, cs.qty_reserved
    from central_stock cs
    where cs.shop_id = p_shop_id
      and cs.product_id in (
        select nullif(elem->>'product_id', '')::uuid from jsonb_array_elements(p_items) elem
      );
end;
$$;

revoke all on function reserve_stock(uuid, uuid, text, jsonb) from public;
grant execute on function reserve_stock(uuid, uuid, text, jsonb) to service_role;

-- ============================================================================
-- commit_stock — reserved -> committed (on_hand -n, reserved -n), on shipment.
-- ============================================================================

create or replace function commit_stock(
  p_shop_id uuid,
  p_order_id uuid,
  p_idem_key text,
  p_items jsonb -- [{"product_id": "<uuid>", "qty": <int > 0>}, ...]
)
returns table (product_id uuid, qty_on_hand integer, qty_reserved integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
  v_composed_key text;
  v_row central_stock%rowtype;
  v_already boolean;
  v_owner_check uuid;
begin
  if p_shop_id is null or p_order_id is null or p_idem_key is null or trim(p_idem_key) = '' then
    raise exception 'commit_stock: p_shop_id, p_order_id and p_idem_key are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'commit_stock: p_items must be a non-empty jsonb array';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_qty := nullif(v_item->>'qty', '')::integer;

    if v_product_id is null then
      raise exception 'commit_stock: item missing product_id: %', v_item;
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'commit_stock: qty must be a positive integer for product %: %', v_product_id, v_item;
    end if;

    select shop_id into v_owner_check from product where id = v_product_id;
    if v_owner_check is null or v_owner_check <> p_shop_id then
      raise exception 'commit_stock: product % does not belong to shop %', v_product_id, p_shop_id;
    end if;

    v_composed_key := p_idem_key || ':' || v_product_id::text;

    select exists(
      select 1 from stock_ledger where shop_id = p_shop_id and idempotency_key = v_composed_key
    ) into v_already;

    if v_already then
      continue;
    end if;

    begin
      update central_stock
        set qty_on_hand = qty_on_hand - v_qty,
            qty_reserved = qty_reserved - v_qty,
            updated_at = now()
        where product_id = v_product_id
          and shop_id = p_shop_id
          and qty_reserved >= v_qty
          and qty_on_hand >= v_qty
        returning * into v_row;

      if not found then
        raise exception
          'commit_stock: cannot commit % units for product % (insufficient reserved/on_hand balance)',
          v_qty, v_product_id
          using errcode = 'P0001';
      end if;

      insert into stock_ledger (
        shop_id, product_id, order_id, move_type, qty,
        reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key
      ) values (
        p_shop_id, v_product_id, p_order_id, 'commit', v_qty,
        -v_qty, -v_qty, v_row.qty_on_hand, v_row.qty_reserved, v_composed_key
      );
    exception
      when unique_violation then
        continue;
    end;
  end loop;

  return query
    select cs.product_id, cs.qty_on_hand, cs.qty_reserved
    from central_stock cs
    where cs.shop_id = p_shop_id
      and cs.product_id in (
        select nullif(elem->>'product_id', '')::uuid from jsonb_array_elements(p_items) elem
      );
end;
$$;

revoke all on function commit_stock(uuid, uuid, text, jsonb) from public;
grant execute on function commit_stock(uuid, uuid, text, jsonb) to service_role;

-- ============================================================================
-- release_stock — reserved -> released (reserved -n, on_hand unchanged), on cancel.
-- ============================================================================

create or replace function release_stock(
  p_shop_id uuid,
  p_order_id uuid,
  p_idem_key text,
  p_items jsonb -- [{"product_id": "<uuid>", "qty": <int > 0>}, ...]
)
returns table (product_id uuid, qty_on_hand integer, qty_reserved integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
  v_composed_key text;
  v_row central_stock%rowtype;
  v_already boolean;
  v_owner_check uuid;
begin
  if p_shop_id is null or p_order_id is null or p_idem_key is null or trim(p_idem_key) = '' then
    raise exception 'release_stock: p_shop_id, p_order_id and p_idem_key are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'release_stock: p_items must be a non-empty jsonb array';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_qty := nullif(v_item->>'qty', '')::integer;

    if v_product_id is null then
      raise exception 'release_stock: item missing product_id: %', v_item;
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'release_stock: qty must be a positive integer for product %: %', v_product_id, v_item;
    end if;

    select shop_id into v_owner_check from product where id = v_product_id;
    if v_owner_check is null or v_owner_check <> p_shop_id then
      raise exception 'release_stock: product % does not belong to shop %', v_product_id, p_shop_id;
    end if;

    v_composed_key := p_idem_key || ':' || v_product_id::text;

    select exists(
      select 1 from stock_ledger where shop_id = p_shop_id and idempotency_key = v_composed_key
    ) into v_already;

    if v_already then
      continue;
    end if;

    begin
      -- Clamp via WHERE qty_reserved >= v_qty: releasing more than is actually
      -- reserved would violate chk_central_stock_non_negative — treated the
      -- same as "insufficient balance" below rather than a silent partial release.
      update central_stock
        set qty_reserved = qty_reserved - v_qty,
            updated_at = now()
        where product_id = v_product_id
          and shop_id = p_shop_id
          and qty_reserved >= v_qty
        returning * into v_row;

      if not found then
        raise exception
          'release_stock: cannot release % units for product % (reserved balance insufficient)',
          v_qty, v_product_id
          using errcode = 'P0001';
      end if;

      insert into stock_ledger (
        shop_id, product_id, order_id, move_type, qty,
        reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key
      ) values (
        p_shop_id, v_product_id, p_order_id, 'release', v_qty,
        -v_qty, 0, v_row.qty_on_hand, v_row.qty_reserved, v_composed_key
      );
    exception
      when unique_violation then
        continue;
    end;
  end loop;

  return query
    select cs.product_id, cs.qty_on_hand, cs.qty_reserved
    from central_stock cs
    where cs.shop_id = p_shop_id
      and cs.product_id in (
        select nullif(elem->>'product_id', '')::uuid from jsonb_array_elements(p_items) elem
      );
end;
$$;

revoke all on function release_stock(uuid, uuid, text, jsonb) from public;
grant execute on function release_stock(uuid, uuid, text, jsonb) to service_role;

-- ============================================================================
-- release_expired_reservations — pg_cron entry point (design D1).
-- Releases reservations for `new` (unpaid) orders whose age exceeds the
-- channel_account's reserve_ttl_hours (default 48h), then marks the order
-- cancelled via the validated status trigger (0001).
-- ============================================================================

create or replace function release_expired_reservations()
returns integer -- number of orders released
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_items jsonb;
  v_count integer := 0;
begin
  for v_order in
    select o.id as order_id, o.shop_id
    from orders o
    join channel_account ca on ca.id = o.channel_account_id
    where o.status = 'new'
      and o.created_at < now() - make_interval(hours => coalesce(ca.reserve_ttl_hours, 48))
    order by o.created_at
    for update of o skip locked
  loop
    select jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'qty', oi.qty))
      into v_items
      from order_item oi
      where oi.order_id = v_order.order_id
        and oi.product_id is not null;

    if v_items is not null then
      perform release_stock(
        v_order.shop_id,
        v_order.order_id,
        'expire:' || v_order.order_id::text,
        v_items
      );
    end if;

    update orders
      set status = 'cancelled',
          cancel_reason = 'reservation_expired'
      where id = v_order.order_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function release_expired_reservations() from public;
grant execute on function release_expired_reservations() to service_role;

-- Scheduling (requires pg_cron extension enabled on the project):
-- select cron.schedule('release-expired-reservations', '*/15 * * * *',
--   $$select release_expired_reservations();$$);
-- Not run automatically by this migration — enabling pg_cron and registering
-- the schedule is an operational (devops) step, left out of this batch since
-- it's an infra action, not schema.
