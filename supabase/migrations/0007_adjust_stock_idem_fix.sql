-- supabase/migrations/0007_adjust_stock_idem_fix.sql
--
-- S1 fix (code-review, C-3PO): adjust_stock's idempotency guard compared the
-- *magnitude* of the requested delta (`abs(p_qty_delta)`) against the ledger
-- row's `qty` column, which ALSO always stores the magnitude -- so replaying
-- the SAME idem_key with the OPPOSITE sign (e.g. +5 then -5) produced two
-- identical magnitudes and was silently treated as "identical retry, no-op"
-- instead of being rejected as "idem_key reused with a different delta".
-- That defeats the entire purpose of the idem-key guard (an adjustment must
-- be applied at most once per idem_key, deterministically) and could hide a
-- real, opposite-direction stock adjustment as a no-op.
--
-- FIX: compare the ledger row's *signed* delta (`on_hand_delta`, which the
-- function already stores as exactly `p_qty_delta` -- see the INSERT below)
-- against the newly-requested `p_qty_delta`, instead of comparing unsigned
-- magnitudes. `qty` (magnitude; NOT NULL CHECK (qty > 0) per 0001) is still
-- stored and still populated for the audit trail/reporting -- only the
-- *comparison* used by the idem-key reuse guard changes.
--
-- Only adjust_stock changes in this migration. reserve_stock/commit_stock/
-- release_stock are unaffected: those functions' own idem-guards already
-- compare a plain positive `qty` against the ledger's `qty`, which is
-- unambiguous there since they never accept a signed delta in the first
-- place. Per the coordinator's instruction, 0005/0006 (already applied) are
-- left untouched -- this is a fresh CREATE OR REPLACE on top of them.

create or replace function adjust_stock(p_shop_id uuid, p_product_id uuid, p_qty_delta integer, p_idem_key text)
returns table (product_id uuid, qty_on_hand integer, qty_reserved integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_check uuid; v_composed_key text; v_existing_delta integer; v_row central_stock%rowtype; v_magnitude integer;
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

  -- S1 fix: compare against the SIGNED delta (on_hand_delta), not the
  -- magnitude (qty) -- +5 and -5 sharing an idem_key must never be treated
  -- as "the same request" just because abs(+5) = abs(-5).
  select sl.on_hand_delta into v_existing_delta from stock_ledger sl where sl.shop_id = p_shop_id and sl.idempotency_key = v_composed_key;
  if found then
    if v_existing_delta <> p_qty_delta then
      raise exception 'adjust_stock: idem_key % already used for product % with a different delta (existing %, requested %)', p_idem_key, p_product_id, v_existing_delta, p_qty_delta using errcode = '23505';
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
    -- S1 fix applies here too: the race-losing concurrent call must recheck
    -- against the winner's SIGNED delta, not magnitude.
    select sl.on_hand_delta into v_existing_delta from stock_ledger sl where sl.shop_id = p_shop_id and sl.idempotency_key = v_composed_key;
    if v_existing_delta is distinct from p_qty_delta then
      raise exception 'adjust_stock: idem_key % already used for product % with a different delta (existing %, requested %)', p_idem_key, p_product_id, v_existing_delta, p_qty_delta using errcode = '23505';
    end if;
  end;
  return query select cs.product_id, cs.qty_on_hand, cs.qty_reserved from central_stock cs where cs.product_id = p_product_id;
end;
$$;

-- Privileges persist across CREATE OR REPLACE FUNCTION (only DROP + CREATE
-- resets them) -- these re-statements aren't strictly required, but are kept
-- explicit for defense-in-depth/auditability, matching the pattern already
-- established in 0006.
revoke execute on function adjust_stock(uuid, uuid, integer, text) from anon, authenticated;
grant execute on function adjust_stock(uuid, uuid, integer, text) to service_role;
