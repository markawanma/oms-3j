-- 0005_stock_rpc_hardening.sql
-- QA/security findings against the 0003 stock RPCs (G1, G2, G3, G4) + the new
-- adjust_stock() RPC required by H3 (manual stock adjustments must go through
-- a ledgered, service-role-only RPC, never a direct central_stock UPDATE).
--
-- All three existing RPCs are replaced in full (`create or replace function`
-- with the same signature) — safe on top of an already-applied 0003, no DROP
-- needed. The shared fix applied to reserve_stock/commit_stock/release_stock:
--
--   G3 (qty validation): every raw item's qty is checked with a regex
--   (`^[0-9]+$`) against the *text* the caller sent, BEFORE any ::integer
--   cast is attempted. This turns "1.5" or "-3" or "abc" into the same
--   friendly "qty must be a positive integer" exception instead of a raw
--   Postgres "invalid input syntax for type integer" cast error.
--
--   G2 (duplicate product_id in one batch): items are aggregated (summed) by
--   product_id via `GROUP BY` before the reserve/commit/release loop runs, so
--   two items for the same product_id in one call add up instead of the
--   second one silently colliding with the first's composed idem key and
--   being skipped as "already applied" (silent under-reserve/under-release).
--
--   G1 (idempotency payload mismatch): replaying an idem_key that was already
--   recorded for a product now compares the *qty actually recorded* in
--   stock_ledger against the qty this call is asking for. Same qty = safe
--   idempotent no-op (unchanged behavior). Different qty = conflict, raises
--   an exception (errcode 23505) instead of silently keeping the first
--   call's result — a mismatched retry is a caller bug (or a tampered
--   payload) that must surface loudly, not be swallowed.

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
  v_agg record;
  v_composed_key text;
  v_row central_stock%rowtype;
  v_owner_check uuid;
  v_existing_qty integer;
begin
  if p_shop_id is null or p_order_id is null or p_idem_key is null or trim(p_idem_key) = '' then
    raise exception 'reserve_stock: p_shop_id, p_order_id and p_idem_key are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'reserve_stock: p_items must be a non-empty jsonb array';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where nullif(elem->>'product_id', '') is null
  ) then
    raise exception 'reserve_stock: item missing product_id: %', p_items;
  end if;

  -- G3: validate the raw text before ever casting to integer.
  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where elem->>'qty' is null
       or elem->>'qty' !~ '^[0-9]+$'
       or (elem->>'qty')::bigint = 0
  ) then
    raise exception 'reserve_stock: qty must be a positive integer for every item: %', p_items;
  end if;

  -- G2: aggregate qty per product_id so a duplicated product_id in the same
  -- batch adds up instead of the second occurrence colliding on the same
  -- composed idem key and being silently skipped (under-reserve).
  for v_agg in
    select (elem->>'product_id')::uuid as product_id, sum((elem->>'qty')::integer)::integer as qty
    from jsonb_array_elements(p_items) elem
    group by (elem->>'product_id')::uuid
    order by 1
  loop
    select shop_id into v_owner_check from product where id = v_agg.product_id;
    if v_owner_check is null or v_owner_check <> p_shop_id then
      raise exception 'reserve_stock: product % does not belong to shop %', v_agg.product_id, p_shop_id;
    end if;

    v_composed_key := p_idem_key || ':' || v_agg.product_id::text;

    select qty into v_existing_qty
      from stock_ledger
      where shop_id = p_shop_id and idempotency_key = v_composed_key;

    if found then
      -- G1: same idem_key reused with a different qty is a conflict, not a
      -- safe retry — raise instead of silently keeping the first result.
      if v_existing_qty <> v_agg.qty then
        raise exception
          'reserve_stock: idem_key % already used for product % with a different qty (existing %, requested %)',
          p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty
          using errcode = '23505';
      end if;
      continue; -- identical retry — safe idempotent no-op
    end if;

    begin
      update central_stock
        set qty_reserved = qty_reserved + v_agg.qty,
            updated_at = now()
        where product_id = v_agg.product_id
          and shop_id = p_shop_id
          and qty_on_hand - qty_reserved >= v_agg.qty
        returning * into v_row;

      if not found then
        raise exception 'reserve_stock: insufficient stock for product % (requested %)', v_agg.product_id, v_agg.qty
          using errcode = 'P0001';
      end if;

      insert into stock_ledger (
        shop_id, product_id, order_id, move_type, qty,
        reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key
      ) values (
        p_shop_id, v_agg.product_id, p_order_id, 'reserve', v_agg.qty,
        v_agg.qty, 0, v_row.qty_on_hand, v_row.qty_reserved, v_composed_key
      );
    exception
      when unique_violation then
        -- A concurrent duplicate call raced us between the SELECT-check
        -- above and this INSERT. Re-check the payload against what actually
        -- landed — same rule as above (raise on mismatch, else no-op).
        select qty into v_existing_qty
          from stock_ledger where shop_id = p_shop_id and idempotency_key = v_composed_key;
        if v_existing_qty is distinct from v_agg.qty then
          raise exception
            'reserve_stock: idem_key % already used for product % with a different qty (existing %, requested %)',
            p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty
            using errcode = '23505';
        end if;
        continue;
    end;
  end loop;

  return query
    select cs.product_id, cs.qty_on_hand, cs.qty_reserved
    from central_stock cs
    where cs.shop_id = p_shop_id
      and cs.product_id in (
        select distinct (elem->>'product_id')::uuid from jsonb_array_elements(p_items) elem
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
  v_agg record;
  v_composed_key text;
  v_row central_stock%rowtype;
  v_owner_check uuid;
  v_existing_qty integer;
begin
  if p_shop_id is null or p_order_id is null or p_idem_key is null or trim(p_idem_key) = '' then
    raise exception 'commit_stock: p_shop_id, p_order_id and p_idem_key are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'commit_stock: p_items must be a non-empty jsonb array';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where nullif(elem->>'product_id', '') is null
  ) then
    raise exception 'commit_stock: item missing product_id: %', p_items;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where elem->>'qty' is null
       or elem->>'qty' !~ '^[0-9]+$'
       or (elem->>'qty')::bigint = 0
  ) then
    raise exception 'commit_stock: qty must be a positive integer for every item: %', p_items;
  end if;

  for v_agg in
    select (elem->>'product_id')::uuid as product_id, sum((elem->>'qty')::integer)::integer as qty
    from jsonb_array_elements(p_items) elem
    group by (elem->>'product_id')::uuid
    order by 1
  loop
    select shop_id into v_owner_check from product where id = v_agg.product_id;
    if v_owner_check is null or v_owner_check <> p_shop_id then
      raise exception 'commit_stock: product % does not belong to shop %', v_agg.product_id, p_shop_id;
    end if;

    v_composed_key := p_idem_key || ':' || v_agg.product_id::text;

    select qty into v_existing_qty
      from stock_ledger
      where shop_id = p_shop_id and idempotency_key = v_composed_key;

    if found then
      if v_existing_qty <> v_agg.qty then
        raise exception
          'commit_stock: idem_key % already used for product % with a different qty (existing %, requested %)',
          p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty
          using errcode = '23505';
      end if;
      continue;
    end if;

    begin
      update central_stock
        set qty_on_hand = qty_on_hand - v_agg.qty,
            qty_reserved = qty_reserved - v_agg.qty,
            updated_at = now()
        where product_id = v_agg.product_id
          and shop_id = p_shop_id
          and qty_reserved >= v_agg.qty
          and qty_on_hand >= v_agg.qty
        returning * into v_row;

      if not found then
        raise exception
          'commit_stock: cannot commit % units for product % (insufficient reserved/on_hand balance)',
          v_agg.qty, v_agg.product_id
          using errcode = 'P0001';
      end if;

      insert into stock_ledger (
        shop_id, product_id, order_id, move_type, qty,
        reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key
      ) values (
        p_shop_id, v_agg.product_id, p_order_id, 'commit', v_agg.qty,
        -v_agg.qty, -v_agg.qty, v_row.qty_on_hand, v_row.qty_reserved, v_composed_key
      );
    exception
      when unique_violation then
        select qty into v_existing_qty
          from stock_ledger where shop_id = p_shop_id and idempotency_key = v_composed_key;
        if v_existing_qty is distinct from v_agg.qty then
          raise exception
            'commit_stock: idem_key % already used for product % with a different qty (existing %, requested %)',
            p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty
            using errcode = '23505';
        end if;
        continue;
    end;
  end loop;

  return query
    select cs.product_id, cs.qty_on_hand, cs.qty_reserved
    from central_stock cs
    where cs.shop_id = p_shop_id
      and cs.product_id in (
        select distinct (elem->>'product_id')::uuid from jsonb_array_elements(p_items) elem
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
  v_agg record;
  v_composed_key text;
  v_row central_stock%rowtype;
  v_owner_check uuid;
  v_existing_qty integer;
begin
  if p_shop_id is null or p_order_id is null or p_idem_key is null or trim(p_idem_key) = '' then
    raise exception 'release_stock: p_shop_id, p_order_id and p_idem_key are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'release_stock: p_items must be a non-empty jsonb array';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where nullif(elem->>'product_id', '') is null
  ) then
    raise exception 'release_stock: item missing product_id: %', p_items;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where elem->>'qty' is null
       or elem->>'qty' !~ '^[0-9]+$'
       or (elem->>'qty')::bigint = 0
  ) then
    raise exception 'release_stock: qty must be a positive integer for every item: %', p_items;
  end if;

  for v_agg in
    select (elem->>'product_id')::uuid as product_id, sum((elem->>'qty')::integer)::integer as qty
    from jsonb_array_elements(p_items) elem
    group by (elem->>'product_id')::uuid
    order by 1
  loop
    select shop_id into v_owner_check from product where id = v_agg.product_id;
    if v_owner_check is null or v_owner_check <> p_shop_id then
      raise exception 'release_stock: product % does not belong to shop %', v_agg.product_id, p_shop_id;
    end if;

    v_composed_key := p_idem_key || ':' || v_agg.product_id::text;

    select qty into v_existing_qty
      from stock_ledger
      where shop_id = p_shop_id and idempotency_key = v_composed_key;

    if found then
      if v_existing_qty <> v_agg.qty then
        raise exception
          'release_stock: idem_key % already used for product % with a different qty (existing %, requested %)',
          p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty
          using errcode = '23505';
      end if;
      continue;
    end if;

    begin
      -- Clamp via WHERE qty_reserved >= v_agg.qty: releasing more than is
      -- actually reserved would violate chk_central_stock_non_negative —
      -- treated the same as "insufficient balance" below rather than a
      -- silent partial release.
      update central_stock
        set qty_reserved = qty_reserved - v_agg.qty,
            updated_at = now()
        where product_id = v_agg.product_id
          and shop_id = p_shop_id
          and qty_reserved >= v_agg.qty
        returning * into v_row;

      if not found then
        raise exception
          'release_stock: cannot release % units for product % (reserved balance insufficient)',
          v_agg.qty, v_agg.product_id
          using errcode = 'P0001';
      end if;

      insert into stock_ledger (
        shop_id, product_id, order_id, move_type, qty,
        reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key
      ) values (
        p_shop_id, v_agg.product_id, p_order_id, 'release', v_agg.qty,
        -v_agg.qty, 0, v_row.qty_on_hand, v_row.qty_reserved, v_composed_key
      );
    exception
      when unique_violation then
        select qty into v_existing_qty
          from stock_ledger where shop_id = p_shop_id and idempotency_key = v_composed_key;
        if v_existing_qty is distinct from v_agg.qty then
          raise exception
            'release_stock: idem_key % already used for product % with a different qty (existing %, requested %)',
            p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty
            using errcode = '23505';
        end if;
        continue;
    end;
  end loop;

  return query
    select cs.product_id, cs.qty_on_hand, cs.qty_reserved
    from central_stock cs
    where cs.shop_id = p_shop_id
      and cs.product_id in (
        select distinct (elem->>'product_id')::uuid from jsonb_array_elements(p_items) elem
      );
end;
$$;

revoke all on function release_stock(uuid, uuid, text, jsonb) from public;
grant execute on function release_stock(uuid, uuid, text, jsonb) to service_role;

-- ============================================================================
-- G4 — release_expired_reservations: add a batch limit (default 500) so a
-- single pg_cron tick can't try to lock/process an unbounded number of
-- orders in one transaction as the table grows. `p_limit` is optional and
-- backward compatible: existing callers (sync-worker's
-- `select release_expired_reservations()`) keep working unchanged, picking
-- up the new default.
--
-- DECISION (scope-per-shop, deferred): the design's job is explicitly a
-- global pg_cron sweep (no shop_id parameter in the original signature, and
-- sync-worker calls it with zero arguments as a standalone job_type). Adding
-- a `p_shop_id` filter would change the call contract and the sync_job
-- dispatch shape for a job that isn't shop-scoped today — batching alone
-- addresses the "unbounded scan" risk without that broader change. Recorded
-- as technical debt below if per-shop scoping is wanted later (e.g. once
-- volume grows enough that this needs to run more than once per pg_cron
-- tick, or per-shop fairness matters).
-- ============================================================================

create or replace function release_expired_reservations(p_limit integer default 500)
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
  if p_limit is null or p_limit <= 0 then
    raise exception 'release_expired_reservations: p_limit must be a positive integer';
  end if;

  for v_order in
    select o.id as order_id, o.shop_id
    from orders o
    join channel_account ca on ca.id = o.channel_account_id
    where o.status = 'new'
      and o.created_at < now() - make_interval(hours => coalesce(ca.reserve_ttl_hours, 48))
    order by o.created_at
    limit p_limit
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

revoke all on function release_expired_reservations(integer) from public;
grant execute on function release_expired_reservations(integer) to service_role;

-- The old zero-arg overload from 0003 no longer exists once `create or
-- replace function release_expired_reservations()` above is superseded by a
-- different signature (`(integer)` is a distinct overload, not a replace) —
-- drop it explicitly so callers can't accidentally hit the un-batched
-- original.
drop function if exists release_expired_reservations();

-- ============================================================================
-- H3 — adjust_stock: the only sanctioned path for a manual stock correction
-- (stock count, damage write-off, etc.). Always ledgered (move_type
-- 'adjustment' — 0001's stock_move_type enum already has this value, no new
-- enum value needed). SECURITY DEFINER + service_role-only EXECUTE, same
-- posture as reserve_stock/commit_stock/release_stock: this is meant to be
-- called from trusted server-side code (an authenticated, owner/admin-gated
-- API route/edge function), not directly by end users.
-- ============================================================================

create or replace function adjust_stock(
  p_shop_id uuid,
  p_product_id uuid,
  p_qty_delta integer, -- signed: positive = stock found/received, negative = stock write-off/damage
  p_idem_key text
)
returns table (product_id uuid, qty_on_hand integer, qty_reserved integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_check uuid;
  v_composed_key text;
  v_existing_qty integer;
  v_row central_stock%rowtype;
  v_magnitude integer;
begin
  if p_shop_id is null or p_product_id is null or p_idem_key is null or trim(p_idem_key) = '' then
    raise exception 'adjust_stock: p_shop_id, p_product_id and p_idem_key are required';
  end if;
  if p_qty_delta is null or p_qty_delta = 0 then
    raise exception 'adjust_stock: p_qty_delta must be a non-zero integer';
  end if;

  select shop_id into v_owner_check from product where id = p_product_id;
  if v_owner_check is null or v_owner_check <> p_shop_id then
    raise exception 'adjust_stock: product % does not belong to shop %', p_product_id, p_shop_id;
  end if;

  v_composed_key := p_idem_key || ':' || p_product_id::text;
  v_magnitude := abs(p_qty_delta);

  select qty into v_existing_qty
    from stock_ledger
    where shop_id = p_shop_id and idempotency_key = v_composed_key;

  if found then
    if v_existing_qty <> v_magnitude then
      raise exception
        'adjust_stock: idem_key % already used for product % with a different qty (existing %, requested %)',
        p_idem_key, p_product_id, v_existing_qty, v_magnitude
        using errcode = '23505';
    end if;
    -- Identical retry — return current state, no-op.
    return query select cs.product_id, cs.qty_on_hand, cs.qty_reserved from central_stock cs where cs.product_id = p_product_id;
    return;
  end if;

  begin
    -- qty_on_hand can never go below qty_reserved (chk_central_stock_reserved_le_on_hand)
    -- nor below zero — both enforced here via the WHERE clause rather than
    -- relying solely on the table CHECK constraint raising a raw error.
    update central_stock
      set qty_on_hand = qty_on_hand + p_qty_delta,
          updated_at = now()
      where product_id = p_product_id
        and shop_id = p_shop_id
        and qty_on_hand + p_qty_delta >= 0
        and qty_on_hand + p_qty_delta >= qty_reserved
      returning * into v_row;

    if not found then
      raise exception
        'adjust_stock: cannot apply delta % to product % (would go negative or below reserved balance)',
        p_qty_delta, p_product_id
        using errcode = 'P0001';
    end if;

    insert into stock_ledger (
      shop_id, product_id, order_id, move_type, qty,
      reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key
    ) values (
      p_shop_id, p_product_id, null, 'adjustment', v_magnitude,
      0, p_qty_delta, v_row.qty_on_hand, v_row.qty_reserved, v_composed_key
    );
  exception
    when unique_violation then
      select qty into v_existing_qty
        from stock_ledger where shop_id = p_shop_id and idempotency_key = v_composed_key;
      if v_existing_qty is distinct from v_magnitude then
        raise exception
          'adjust_stock: idem_key % already used for product % with a different qty (existing %, requested %)',
          p_idem_key, p_product_id, v_existing_qty, v_magnitude
          using errcode = '23505';
      end if;
  end;

  return query
    select cs.product_id, cs.qty_on_hand, cs.qty_reserved from central_stock cs where cs.product_id = p_product_id;
end;
$$;

revoke all on function adjust_stock(uuid, uuid, integer, text) from public;
grant execute on function adjust_stock(uuid, uuid, integer, text) to service_role;
