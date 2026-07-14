-- 0006_stock_rpc_runtime_fixes.sql
-- Two runtime bugs found only by executing 0001-0005 against a real Postgres
-- (they pass any static/"balanced parens" review — they fail at call time):
--
--   BUG A (correctness): reserve_stock/commit_stock/release_stock/adjust_stock
--   all use `RETURNS TABLE (product_id uuid, qty_on_hand integer,
--   qty_reserved integer)`. Those OUT columns are in-scope PL/pgSQL variables,
--   so the unqualified `central_stock` column references inside the
--   `UPDATE central_stock ... WHERE product_id = ...` are ambiguous
--   (42702: "column reference \"product_id\" is ambiguous") and every call
--   raised before doing any work. Fixed by aliasing the update target
--   (`update central_stock as cs ... where cs.<col>`) so every column
--   reference is unambiguous.
--
--   BUG B (security): `revoke ... from public` is NOT sufficient on Supabase —
--   the project's default privileges explicitly grant EXECUTE on new public
--   functions to `anon` and `authenticated` (separate from PUBLIC), so those
--   roles could still call reserve_stock/adjust_stock/etc. over PostgREST RPC.
--   Confirmed via has_function_privilege('anon', ...) = true. Fixed by
--   revoking EXECUTE from anon + authenticated explicitly on every
--   service-role-only stock RPC. reveal_channel_account_credential_ref keeps
--   its intentional `authenticated` grant (it re-checks owner/admin membership
--   internally).

-- ============================================================================
-- BUG A — re-create the four RPCs with an aliased UPDATE target.
-- ============================================================================

create or replace function reserve_stock(p_shop_id uuid, p_order_id uuid, p_idem_key text, p_items jsonb)
returns table (product_id uuid, qty_on_hand integer, qty_reserved integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_agg record; v_composed_key text; v_row central_stock%rowtype; v_owner_check uuid; v_existing_qty integer;
begin
  if p_shop_id is null or p_order_id is null or p_idem_key is null or trim(p_idem_key) = '' then
    raise exception 'reserve_stock: p_shop_id, p_order_id and p_idem_key are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'reserve_stock: p_items must be a non-empty jsonb array';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) elem where nullif(elem->>'product_id', '') is null) then
    raise exception 'reserve_stock: item missing product_id: %', p_items;
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) elem where elem->>'qty' is null or elem->>'qty' !~ '^[0-9]+$' or (elem->>'qty')::bigint = 0) then
    raise exception 'reserve_stock: qty must be a positive integer for every item: %', p_items;
  end if;
  for v_agg in
    select (elem->>'product_id')::uuid as product_id, sum((elem->>'qty')::integer)::integer as qty
    from jsonb_array_elements(p_items) elem group by (elem->>'product_id')::uuid order by 1
  loop
    select shop_id into v_owner_check from product where id = v_agg.product_id;
    if v_owner_check is null or v_owner_check <> p_shop_id then
      raise exception 'reserve_stock: product % does not belong to shop %', v_agg.product_id, p_shop_id;
    end if;
    v_composed_key := p_idem_key || ':' || v_agg.product_id::text;
    select sl.qty into v_existing_qty from stock_ledger sl where sl.shop_id = p_shop_id and sl.idempotency_key = v_composed_key;
    if found then
      if v_existing_qty <> v_agg.qty then
        raise exception 'reserve_stock: idem_key % already used for product % with a different qty (existing %, requested %)', p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty using errcode = '23505';
      end if;
      continue;
    end if;
    begin
      update central_stock as cs set qty_reserved = cs.qty_reserved + v_agg.qty, updated_at = now()
        where cs.product_id = v_agg.product_id and cs.shop_id = p_shop_id and cs.qty_on_hand - cs.qty_reserved >= v_agg.qty
        returning cs.* into v_row;
      if not found then
        raise exception 'reserve_stock: insufficient stock for product % (requested %)', v_agg.product_id, v_agg.qty using errcode = 'P0001';
      end if;
      insert into stock_ledger (shop_id, product_id, order_id, move_type, qty, reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key)
      values (p_shop_id, v_agg.product_id, p_order_id, 'reserve', v_agg.qty, v_agg.qty, 0, v_row.qty_on_hand, v_row.qty_reserved, v_composed_key);
    exception when unique_violation then
      select sl.qty into v_existing_qty from stock_ledger sl where sl.shop_id = p_shop_id and sl.idempotency_key = v_composed_key;
      if v_existing_qty is distinct from v_agg.qty then
        raise exception 'reserve_stock: idem_key % already used for product % with a different qty (existing %, requested %)', p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty using errcode = '23505';
      end if;
      continue;
    end;
  end loop;
  return query select cs.product_id, cs.qty_on_hand, cs.qty_reserved from central_stock cs
    where cs.shop_id = p_shop_id and cs.product_id in (select distinct (elem->>'product_id')::uuid from jsonb_array_elements(p_items) elem);
end;
$$;

create or replace function commit_stock(p_shop_id uuid, p_order_id uuid, p_idem_key text, p_items jsonb)
returns table (product_id uuid, qty_on_hand integer, qty_reserved integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_agg record; v_composed_key text; v_row central_stock%rowtype; v_owner_check uuid; v_existing_qty integer;
begin
  if p_shop_id is null or p_order_id is null or p_idem_key is null or trim(p_idem_key) = '' then
    raise exception 'commit_stock: p_shop_id, p_order_id and p_idem_key are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'commit_stock: p_items must be a non-empty jsonb array';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) elem where nullif(elem->>'product_id', '') is null) then
    raise exception 'commit_stock: item missing product_id: %', p_items;
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) elem where elem->>'qty' is null or elem->>'qty' !~ '^[0-9]+$' or (elem->>'qty')::bigint = 0) then
    raise exception 'commit_stock: qty must be a positive integer for every item: %', p_items;
  end if;
  for v_agg in
    select (elem->>'product_id')::uuid as product_id, sum((elem->>'qty')::integer)::integer as qty
    from jsonb_array_elements(p_items) elem group by (elem->>'product_id')::uuid order by 1
  loop
    select shop_id into v_owner_check from product where id = v_agg.product_id;
    if v_owner_check is null or v_owner_check <> p_shop_id then
      raise exception 'commit_stock: product % does not belong to shop %', v_agg.product_id, p_shop_id;
    end if;
    v_composed_key := p_idem_key || ':' || v_agg.product_id::text;
    select sl.qty into v_existing_qty from stock_ledger sl where sl.shop_id = p_shop_id and sl.idempotency_key = v_composed_key;
    if found then
      if v_existing_qty <> v_agg.qty then
        raise exception 'commit_stock: idem_key % already used for product % with a different qty (existing %, requested %)', p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty using errcode = '23505';
      end if;
      continue;
    end if;
    begin
      update central_stock as cs set qty_on_hand = cs.qty_on_hand - v_agg.qty, qty_reserved = cs.qty_reserved - v_agg.qty, updated_at = now()
        where cs.product_id = v_agg.product_id and cs.shop_id = p_shop_id and cs.qty_reserved >= v_agg.qty and cs.qty_on_hand >= v_agg.qty
        returning cs.* into v_row;
      if not found then
        raise exception 'commit_stock: cannot commit % units for product % (insufficient reserved/on_hand balance)', v_agg.qty, v_agg.product_id using errcode = 'P0001';
      end if;
      insert into stock_ledger (shop_id, product_id, order_id, move_type, qty, reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key)
      values (p_shop_id, v_agg.product_id, p_order_id, 'commit', v_agg.qty, -v_agg.qty, -v_agg.qty, v_row.qty_on_hand, v_row.qty_reserved, v_composed_key);
    exception when unique_violation then
      select sl.qty into v_existing_qty from stock_ledger sl where sl.shop_id = p_shop_id and sl.idempotency_key = v_composed_key;
      if v_existing_qty is distinct from v_agg.qty then
        raise exception 'commit_stock: idem_key % already used for product % with a different qty (existing %, requested %)', p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty using errcode = '23505';
      end if;
      continue;
    end;
  end loop;
  return query select cs.product_id, cs.qty_on_hand, cs.qty_reserved from central_stock cs
    where cs.shop_id = p_shop_id and cs.product_id in (select distinct (elem->>'product_id')::uuid from jsonb_array_elements(p_items) elem);
end;
$$;

create or replace function release_stock(p_shop_id uuid, p_order_id uuid, p_idem_key text, p_items jsonb)
returns table (product_id uuid, qty_on_hand integer, qty_reserved integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_agg record; v_composed_key text; v_row central_stock%rowtype; v_owner_check uuid; v_existing_qty integer;
begin
  if p_shop_id is null or p_order_id is null or p_idem_key is null or trim(p_idem_key) = '' then
    raise exception 'release_stock: p_shop_id, p_order_id and p_idem_key are required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'release_stock: p_items must be a non-empty jsonb array';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) elem where nullif(elem->>'product_id', '') is null) then
    raise exception 'release_stock: item missing product_id: %', p_items;
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) elem where elem->>'qty' is null or elem->>'qty' !~ '^[0-9]+$' or (elem->>'qty')::bigint = 0) then
    raise exception 'release_stock: qty must be a positive integer for every item: %', p_items;
  end if;
  for v_agg in
    select (elem->>'product_id')::uuid as product_id, sum((elem->>'qty')::integer)::integer as qty
    from jsonb_array_elements(p_items) elem group by (elem->>'product_id')::uuid order by 1
  loop
    select shop_id into v_owner_check from product where id = v_agg.product_id;
    if v_owner_check is null or v_owner_check <> p_shop_id then
      raise exception 'release_stock: product % does not belong to shop %', v_agg.product_id, p_shop_id;
    end if;
    v_composed_key := p_idem_key || ':' || v_agg.product_id::text;
    select sl.qty into v_existing_qty from stock_ledger sl where sl.shop_id = p_shop_id and sl.idempotency_key = v_composed_key;
    if found then
      if v_existing_qty <> v_agg.qty then
        raise exception 'release_stock: idem_key % already used for product % with a different qty (existing %, requested %)', p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty using errcode = '23505';
      end if;
      continue;
    end if;
    begin
      update central_stock as cs set qty_reserved = cs.qty_reserved - v_agg.qty, updated_at = now()
        where cs.product_id = v_agg.product_id and cs.shop_id = p_shop_id and cs.qty_reserved >= v_agg.qty
        returning cs.* into v_row;
      if not found then
        raise exception 'release_stock: cannot release % units for product % (reserved balance insufficient)', v_agg.qty, v_agg.product_id using errcode = 'P0001';
      end if;
      insert into stock_ledger (shop_id, product_id, order_id, move_type, qty, reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key)
      values (p_shop_id, v_agg.product_id, p_order_id, 'release', v_agg.qty, -v_agg.qty, 0, v_row.qty_on_hand, v_row.qty_reserved, v_composed_key);
    exception when unique_violation then
      select sl.qty into v_existing_qty from stock_ledger sl where sl.shop_id = p_shop_id and sl.idempotency_key = v_composed_key;
      if v_existing_qty is distinct from v_agg.qty then
        raise exception 'release_stock: idem_key % already used for product % with a different qty (existing %, requested %)', p_idem_key, v_agg.product_id, v_existing_qty, v_agg.qty using errcode = '23505';
      end if;
      continue;
    end;
  end loop;
  return query select cs.product_id, cs.qty_on_hand, cs.qty_reserved from central_stock cs
    where cs.shop_id = p_shop_id and cs.product_id in (select distinct (elem->>'product_id')::uuid from jsonb_array_elements(p_items) elem);
end;
$$;

create or replace function adjust_stock(p_shop_id uuid, p_product_id uuid, p_qty_delta integer, p_idem_key text)
returns table (product_id uuid, qty_on_hand integer, qty_reserved integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_check uuid; v_composed_key text; v_existing_qty integer; v_row central_stock%rowtype; v_magnitude integer;
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
  select sl.qty into v_existing_qty from stock_ledger sl where sl.shop_id = p_shop_id and sl.idempotency_key = v_composed_key;
  if found then
    if v_existing_qty <> v_magnitude then
      raise exception 'adjust_stock: idem_key % already used for product % with a different qty (existing %, requested %)', p_idem_key, p_product_id, v_existing_qty, v_magnitude using errcode = '23505';
    end if;
    return query select cs.product_id, cs.qty_on_hand, cs.qty_reserved from central_stock cs where cs.product_id = p_product_id;
    return;
  end if;
  begin
    update central_stock as cs set qty_on_hand = cs.qty_on_hand + p_qty_delta, updated_at = now()
      where cs.product_id = p_product_id and cs.shop_id = p_shop_id and cs.qty_on_hand + p_qty_delta >= 0 and cs.qty_on_hand + p_qty_delta >= cs.qty_reserved
      returning cs.* into v_row;
    if not found then
      raise exception 'adjust_stock: cannot apply delta % to product % (would go negative or below reserved balance)', p_qty_delta, p_product_id using errcode = 'P0001';
    end if;
    insert into stock_ledger (shop_id, product_id, order_id, move_type, qty, reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key)
    values (p_shop_id, p_product_id, null, 'adjustment', v_magnitude, 0, p_qty_delta, v_row.qty_on_hand, v_row.qty_reserved, v_composed_key);
  exception when unique_violation then
    select sl.qty into v_existing_qty from stock_ledger sl where sl.shop_id = p_shop_id and sl.idempotency_key = v_composed_key;
    if v_existing_qty is distinct from v_magnitude then
      raise exception 'adjust_stock: idem_key % already used for product % with a different qty (existing %, requested %)', p_idem_key, p_product_id, v_existing_qty, v_magnitude using errcode = '23505';
    end if;
  end;
  return query select cs.product_id, cs.qty_on_hand, cs.qty_reserved from central_stock cs where cs.product_id = p_product_id;
end;
$$;

-- ============================================================================
-- BUG B — revoke EXECUTE from anon + authenticated (Supabase default
-- privileges granted them separately from PUBLIC). These RPCs are
-- service-role-only (called from trusted server-side worker/route code).
-- ============================================================================

revoke execute on function reserve_stock(uuid, uuid, text, jsonb) from anon, authenticated;
revoke execute on function commit_stock(uuid, uuid, text, jsonb) from anon, authenticated;
revoke execute on function release_stock(uuid, uuid, text, jsonb) from anon, authenticated;
revoke execute on function release_expired_reservations(integer) from anon, authenticated;
revoke execute on function adjust_stock(uuid, uuid, integer, text) from anon, authenticated;

-- reveal_channel_account_credential_ref keeps its intentional `authenticated`
-- grant (it re-checks owner/admin membership internally) — only strip anon.
revoke execute on function reveal_channel_account_credential_ref(uuid) from anon;
