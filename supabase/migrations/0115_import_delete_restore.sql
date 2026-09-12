-- 0115_import_delete_restore.sql
-- Cancel-detection Phase 1 (design: Yoda, 11 ก.ย. 69) — the two write RPCs:
-- analytics.import_delete_orders (§4) and analytics.import_restore_orders
-- (§4). Both call analytics.import_missing_orders_candidates (0113) to
-- re-derive the candidate set instead of trusting anything the client
-- sends except the ids to act on — a delete/restore call can never select a
-- looser rule than what the read RPC showed the owner on screen.
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via
-- MCP after 0112/0113/0114.

-- ============================================================================
-- 0. Extend analytics.stg_order_line_import.import_status's CHECK to allow
--    'tombstoned' — QA gate (12 ก.ย. 69, cancel-detection review).
--
--    This table's import_status is TEXT + CHECK (0041:47-49), NOT the
--    analytics.import_status_t ENUM that 0112 added 'tombstoned' to. That
--    enum backs stg_order_import — the ORDER-header staging table — a
--    DIFFERENT table that happens to share status vocabulary by convention
--    only. This ALTER is the line-item table's own, separate extension; it
--    is a plain CHECK swap (not `alter type ... add value`), so unlike
--    0112's enum change it is safe to use in the SAME transaction as the
--    functions below that start writing 'tombstoned' into this column.
--
--    Why this was needed: before this fix, import_delete_orders marked a
--    deleted order's line items 'orphan' (identical to a genuine "line
--    arrived before its matching order-report file" gap). getOrphanBacklog
--    (lib/actions/import-line-items.ts) reads import_status='orphan'
--    directly, so every deliberate cancel surfaced in the orphan-backlog UI
--    as unexplained missing data the owner was expected to go "investigate"
--    — exactly the outcome the whole cancel-detection feature exists to
--    prevent. 'tombstoned' gives deleted-order line items their own status,
--    same distinction 0112/0114 already draw on the order-header side.
-- ============================================================================

alter table analytics.stg_order_line_import
  drop constraint stg_order_line_import_import_status_check;

alter table analytics.stg_order_line_import
  add constraint stg_order_line_import_import_status_check
  check (import_status in ('pending', 'transformed', 'orphan', 'skipped_blank', 'sku_unmapped', 'error', 'tombstoned'));

-- ============================================================================
-- 1. analytics.import_delete_orders(shop, batch, ids, reason)
--
--    All-or-nothing: any id outside the freshly-recomputed candidate set, or
--    a candidate_count over the cap, aborts the WHOLE call (raise rolls back
--    everything, including snapshot rows already inserted this call) —
--    design §4 "id ต้อง ⊂ S ไม่งั้น raise ทั้งก้อน". Snapshot-then-delete,
--    one order at a time inside a loop (same "explicit control flow over
--    a single giant CTE" style transform_pending_orders itself uses), so
--    each row's own prefix-group evidence lands correctly on its own
--    fact_order_deleted row.
-- ============================================================================

create or replace function analytics.import_delete_orders(
  p_shop_id uuid,
  p_batch_id uuid,
  p_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_reason text;
  v_cap int;
  v_file_order_count int;
  v_candidate_count int;
  v_invalid_ids uuid[];
  v_batch_file_name text;
  v_c record;
  v_deleted_ids uuid[] := '{}';
  v_deleted_revenue numeric := 0;
  v_deleted_count int := 0;
  v_cascade_fk_count int;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_shop_id is null or p_batch_id is null then
    raise exception 'import_delete_orders: p_shop_id and p_batch_id are required';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null or array_length(p_ids, 1) = 0 then
    raise exception 'import_delete_orders: p_ids must contain at least one id';
  end if;
  if array_length(p_ids, 1) > 200 then
    raise exception 'import_delete_orders: cannot delete more than 200 orders in one call (got %)', array_length(p_ids, 1);
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'import_delete_orders: reason is required';
  end if;

  -- security review C-1 guard (12 ก.ย. 69): the snapshot below covers
  -- exactly 3 ON DELETE CASCADE foreign keys into analytics.fact_order
  -- (dim_address, fact_order_item, crm_order_override — confirmed against
  -- pg_constraint on the live DB 12 ก.ย. 69). If that count ever changes —
  -- someone adds a new table cascading off fact_order and forgets this
  -- function exists — this raises loudly instead of silently deleting rows
  -- restore can never bring back. Runs on every call, not just once, so it
  -- stays correct even if this function is never touched again.
  select count(*) into v_cascade_fk_count
    from pg_constraint c
    where c.contype = 'f' and c.confdeltype = 'c'
      and c.confrelid = 'analytics.fact_order'::regclass;
  if v_cascade_fk_count <> 3 then
    raise exception 'import_delete_orders: expected exactly 3 ON DELETE CASCADE foreign keys into analytics.fact_order (dim_address, fact_order_item, crm_order_override) but found % — the snapshot/restore logic in this function does not necessarily cover all cascading tables anymore; refusing to delete anything until this is reconciled',
      v_cascade_fk_count;
  end if;

  -- serialize against a concurrent import for the same shop (0114 takes the
  -- same advisory-lock key) — closes the race design §5 point 2 flags.
  perform pg_advisory_xact_lock(hashtext('analytics.fact_order:' || p_shop_id::text));

  -- M-2 (security review 12 ก.ย. 69): scope to this shop too — a batch id
  -- collision across shops is not possible (uuid pk) but an unscoped select
  -- here is inconsistent with every other lookup in this function and was
  -- flagged on review; costs nothing to add.
  select b.file_name into v_batch_file_name from analytics.stg_import_batch b where b.id = p_batch_id and b.shop_id = p_shop_id;

  -- re-derive the candidate set NOW (not trusting anything the caller sent
  -- except p_ids) — this call also re-runs P1-P4 and raises if the batch is
  -- blocked, so a delete request against a since-invalidated batch fails
  -- loudly instead of silently matching zero candidates.
  select count(*), max(file_order_count)
    into v_candidate_count, v_file_order_count
    from analytics.import_missing_orders_candidates(p_shop_id, p_batch_id);

  v_cap := greatest(20, ceil(coalesce(v_file_order_count, 0) * 0.15));
  if v_candidate_count > v_cap then
    raise exception 'import_delete_orders: % candidates exceeds the safety cap of % for this batch (file_order_count=%) — investigate before bulk-deleting, nothing was deleted',
      v_candidate_count, v_cap, v_file_order_count;
  end if;

  -- NOT IN (uncorrelated subquery), not NOT EXISTS/a correlated join — the
  -- candidates function is VOLATILE (plpgsql default) and internally
  -- rebuilds a temp table on every call, so a correlated form here would
  -- re-run the whole candidate computation once per element of p_ids
  -- instead of once total. fact_order_id is always non-null (fo.id, a PK),
  -- so NOT IN's null-poisoning pitfall does not apply.
  select array_agg(x) into v_invalid_ids
    from unnest(p_ids) as x
    where x not in (select fact_order_id from analytics.import_missing_orders_candidates(p_shop_id, p_batch_id));
  if v_invalid_ids is not null and array_length(v_invalid_ids, 1) > 0 then
    raise exception 'import_delete_orders: % of the requested id(s) are not in the current candidate set (e.g. %) — refusing the whole request, nothing was deleted',
      array_length(v_invalid_ids, 1), v_invalid_ids[1];
  end if;

  -- lock every target row for the rest of this transaction before snapshot.
  perform 1 from analytics.fact_order where id = any (p_ids) and shop_id = p_shop_id for update;

  for v_c in
    select * from analytics.import_missing_orders_candidates(p_shop_id, p_batch_id) c
    where c.fact_order_id = any (p_ids)
  loop
    insert into analytics.fact_order_deleted (
      shop_id, fact_order_id, source_order_no, channel_id, order_date, revenue, customer_id,
      order_row, item_rows, address_rows, override_row, stg_order_import_ids, stg_line_links,
      detected_by_batch_id, detected_by_file_name, evidence, reason, deleted_by
    )
    select
      p_shop_id, fo.id, fo.source_order_no, fo.channel_id, fo.order_date, fo.revenue, fo.customer_id,
      to_jsonb(fo),
      coalesce(
        (select jsonb_agg(to_jsonb(foi) order by foi.id) from analytics.fact_order_item foi where foi.fact_order_id = fo.id),
        '[]'::jsonb
      ),
      -- C-1: dim_address also ON DELETE CASCADEs off fact_order_id (0010:441)
      -- and must be snapshotted the same way fact_order_item is, or restore
      -- silently loses the shipping address forever.
      coalesce(
        (select jsonb_agg(to_jsonb(da) order by da.id) from analytics.dim_address da where da.fact_order_id = fo.id and da.shop_id = p_shop_id),
        '[]'::jsonb
      ),
      (select to_jsonb(co) from analytics.crm_order_override co where co.fact_order_id = fo.id),
      coalesce(
        (select array_agg(si.id) from analytics.stg_order_import si where si.shop_id = p_shop_id and si.fact_order_id = fo.id),
        '{}'
      ),
      coalesce(
        (select jsonb_agg(jsonb_build_object('stg_order_line_import_id', sli.id, 'fact_order_item_id', sli.fact_order_item_id))
           from analytics.stg_order_line_import sli
           where sli.shop_id = p_shop_id and sli.source_order_no = fo.source_order_no and sli.fact_order_item_id is not null),
        '[]'::jsonb
      ),
      p_batch_id, v_batch_file_name,
      jsonb_build_object(
        'prefix', v_c.prefix, 'lo', v_c.group_lo, 'hi', v_c.group_hi,
        'date_lo', v_c.group_date_lo, 'date_hi', v_c.group_date_hi,
        'channels', v_c.file_channels, 'file_order_count', v_c.file_order_count,
        'candidate_count', v_candidate_count
      ),
      v_reason, auth.uid()
    from analytics.fact_order fo
    where fo.id = v_c.fact_order_id and fo.shop_id = p_shop_id;

    -- tombstone the staging lineage for THIS order before delete severs it
    -- (ON DELETE SET NULL only clears the FK, never touches import_status).
    update analytics.stg_order_import
      set import_status = 'tombstoned'
      where shop_id = p_shop_id and fact_order_id = v_c.fact_order_id;

    -- QA gate (12 ก.ย. 69): 'tombstoned', not 'orphan' — see the migration
    -- header (section 0) for why conflating the two broke getOrphanBacklog.
    -- Condition unchanged from before (fact_order_item_id is not null: only
    -- rows this delete is actively un-linking) — a stray 'pending'/'error'/
    -- already-'orphan' row for this source_order_no from some OTHER batch is
    -- deliberately left alone here (its own status still means whatever it
    -- meant); getOrphanBacklog's own added filter (lib/import/orphan-
    -- backlog scope, item 3 of this gate) is what hides ALL orphan rows for
    -- a tombstoned source_order_no from the UI regardless of how they got
    -- there — that is the single place this whole class of row is excluded,
    -- so this UPDATE does not need to chase every possible prior status.
    update analytics.stg_order_line_import
      set import_status = 'tombstoned'
      where shop_id = p_shop_id and source_order_no = v_c.source_order_no and fact_order_item_id is not null;

    v_deleted_ids := array_append(v_deleted_ids, v_c.fact_order_id);
    v_deleted_revenue := v_deleted_revenue + coalesce(v_c.revenue, 0);
    v_deleted_count := v_deleted_count + 1;
  end loop;

  -- physical delete — cascades fact_order_item / dim_address /
  -- crm_order_override (all ON DELETE CASCADE per 0010/0021), and
  -- ON DELETE SET NULLs stg_order_import.fact_order_id (already tombstoned
  -- above) and, transitively via fact_order_item's own cascade,
  -- stg_order_line_import.fact_order_item_id (already marked orphan above).
  delete from analytics.fact_order where id = any (v_deleted_ids) and shop_id = p_shop_id;

  -- recompute is_new_customer (shop-wide, set-based, only writes rows whose
  -- value actually changed — 0045) + first/last_order_at scoped to affected
  -- customers only (0069 precedent), including nulling both out for a
  -- customer left with zero remaining orders.
  with affected as (
    select distinct fod.customer_id
    from analytics.fact_order_deleted fod
    where fod.fact_order_id = any (v_deleted_ids) and fod.customer_id is not null
  ),
  agg as (
    select
      a.customer_id,
      (select min(fo2.order_date) from analytics.fact_order fo2 where fo2.shop_id = p_shop_id and fo2.customer_id = a.customer_id)::timestamptz as first_at,
      (select max(fo2.order_date) from analytics.fact_order fo2 where fo2.shop_id = p_shop_id and fo2.customer_id = a.customer_id)::timestamptz as last_at
    from affected a
  )
  update analytics.dim_customer c
  set first_order_at = agg.first_at, last_order_at = agg.last_at, updated_at = now()
  from agg
  where agg.customer_id = c.id
    and (c.first_order_at is distinct from agg.first_at or c.last_order_at is distinct from agg.last_at);

  perform analytics.recompute_is_new_customer(p_shop_id);

  return jsonb_build_object(
    'deleted_count', v_deleted_count,
    'deleted_revenue_thb', v_deleted_revenue,
    'deleted_ids', to_jsonb(v_deleted_ids)
  );
end;
$$;

revoke execute on function analytics.import_delete_orders(uuid, uuid, uuid[], text) from public, anon, authenticated;
-- H-1 (security review 12 ก.ย. 69): service_role ONLY — this RPC is never
-- called via a user session (lib/actions/import-missing-orders.ts always
-- uses getServiceClient()); granting authenticated execute let a logged-in
-- user call this permanently-deleting RPC directly over PostgREST, bypassing
-- the app-layer requireOwnerAdmin() gate entirely (crm_require_owner_admin
-- inside the function is defense-in-depth, not meant to be the only gate).
-- Matches 0111/0114's own pattern.
grant execute on function analytics.import_delete_orders(uuid, uuid, uuid[], text) to service_role;

-- ============================================================================
-- 2. analytics.import_restore_orders(shop, deleted_ids)
--
--    All-or-nothing, same as delete. Refuses (raises) if a LIVE fact_order
--    already occupies (shop_id, source_order_no) — design §10's own flagged
--    risk ("Shipnity ใช้เลขซ้ำ") means that slot may since have been
--    legitimately reused by an unrelated new sale; resurrecting the old
--    snapshot on top of it would either 23505 anyway (different id, same
--    unique key) or silently clobber a real order if it somehow shared the
--    id, so this is checked explicitly for a clear error instead of relying
--    on the constraint violation.
--
--    Customer re-link walks merged_into_id exactly ONE hop (design §4 "เดิน
--    merged_into_id 1 ชั้น") — not a full chain walk — so a restored order
--    lands on the customer's CURRENT canonical identity if it was merged
--    away after the delete, without silently resurrecting a reference to a
--    merged (soft-retired) dim_customer row.
-- ============================================================================

create or replace function analytics.import_restore_orders(
  p_shop_id uuid,
  p_deleted_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_del analytics.fact_order_deleted%rowtype;
  v_fo analytics.fact_order%rowtype;
  v_item record;
  v_addr record;
  v_link record;
  v_resolved_customer_id uuid;
  v_conflict_id uuid;
  v_restored_ids uuid[] := '{}';
  v_restored_revenue numeric := 0;
  v_restored_count int := 0;
  v_id uuid;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_shop_id is null then
    raise exception 'import_restore_orders: p_shop_id is required';
  end if;
  if p_deleted_ids is null or array_length(p_deleted_ids, 1) is null or array_length(p_deleted_ids, 1) = 0 then
    raise exception 'import_restore_orders: p_deleted_ids must contain at least one id';
  end if;
  if array_length(p_deleted_ids, 1) > 200 then
    raise exception 'import_restore_orders: cannot restore more than 200 orders in one call (got %)', array_length(p_deleted_ids, 1);
  end if;

  perform pg_advisory_xact_lock(hashtext('analytics.fact_order:' || p_shop_id::text));

  foreach v_id in array p_deleted_ids
  loop
    select * into v_del
      from analytics.fact_order_deleted
      where id = v_id and shop_id = p_shop_id and restored_at is null
      for update;
    if not found then
      raise exception 'import_restore_orders: deleted-order record % not found (already restored, or belongs to another shop) — refusing the whole request, nothing was restored', v_id;
    end if;

    select fo2.id into v_conflict_id
      from analytics.fact_order fo2
      where fo2.shop_id = p_shop_id and fo2.source_order_no = v_del.source_order_no;
    if v_conflict_id is not null then
      raise exception 'import_restore_orders: a live order already exists for source_order_no % (id %) — Shipnity may have reused this number for a new sale; refusing the whole request, nothing was restored',
        v_del.source_order_no, v_conflict_id;
    end if;

    -- customer re-link, one merge hop only.
    v_resolved_customer_id := null;
    if (v_del.order_row ->> 'customer_id') is not null then
      select coalesce(dc.merged_into_id, dc.id) into v_resolved_customer_id
        from analytics.dim_customer dc
        where dc.id = (v_del.order_row ->> 'customer_id')::uuid;
      -- if the lookup finds nothing (customer row genuinely gone), fall back
      -- to NULL rather than failing the whole restore over a display-only
      -- attribute the order's own money/date/channel fields don't depend on.
    end if;

    v_fo := jsonb_populate_record(null::analytics.fact_order, v_del.order_row);
    v_fo.customer_id := v_resolved_customer_id;
    insert into analytics.fact_order select (v_fo).*;

    -- C-1 (security review 12 ก.ย. 69): restore dim_address rows before
    -- items, same insertion-order reasoning the design already used for
    -- fact_order-before-fact_order_item (fact_order_id must exist first —
    -- dim_address.fact_order_id has no NOT NULL but IS the FK the restored
    -- addresses need to point at). Restored with the SAME id the row had at
    -- delete time (jsonb_populate_record carries `id` through, exactly like
    -- v_fo/v_item above) — not re-derived from customer_id, so this does
    -- NOT walk merged_into_id the way fact_order.customer_id does above; a
    -- restored address can reference a since-merged (soft-retired)
    -- dim_customer row, same as it would have before the delete. That is a
    -- pre-existing property of dim_address, not something this restore path
    -- changes.
    for v_addr in select * from jsonb_array_elements(v_del.address_rows)
    loop
      insert into analytics.dim_address
      select (jsonb_populate_record(null::analytics.dim_address, v_addr.value)).*;
    end loop;

    for v_item in select * from jsonb_array_elements(v_del.item_rows)
    loop
      insert into analytics.fact_order_item
      select (jsonb_populate_record(null::analytics.fact_order_item, v_item.value)).*;
    end loop;

    if v_del.override_row is not null then
      insert into analytics.crm_order_override
      select (jsonb_populate_record(null::analytics.crm_order_override, v_del.override_row)).*;
    end if;

    if v_del.stg_order_import_ids is not null and array_length(v_del.stg_order_import_ids, 1) > 0 then
      update analytics.stg_order_import
        set fact_order_id = v_fo.id, import_status = 'transformed', error_detail = null, error_code = null
        where id = any (v_del.stg_order_import_ids) and shop_id = p_shop_id;
    end if;

    for v_link in select * from jsonb_array_elements(v_del.stg_line_links)
    loop
      update analytics.stg_order_line_import
        set fact_order_item_id = (v_link.value ->> 'fact_order_item_id')::uuid,
            import_status = 'transformed', error_detail = null
        where id = (v_link.value ->> 'stg_order_line_import_id')::uuid and shop_id = p_shop_id;
    end loop;

    -- QA gate (12 ก.ย. 69): stg_line_links (above) only covers line rows
    -- that were ALREADY linked to a fact_order_item at delete time. A line
    -- report re-imported WHILE this order was tombstoned lands at
    -- import_status='tombstoned' with fact_order_item_id still null (see
    -- transform_pending_order_lines below) — those rows have no entry in
    -- stg_line_links at all, so the loop above never touches them and they
    -- would stay stuck at 'tombstoned' forever even after the order comes
    -- back. Reset them to 'pending' so the next transform_pending_order_
    -- lines run (whenever that next runs — not triggered from here, matching
    -- this codebase's existing pattern of transform being a separate,
    -- explicitly-invoked step) picks them up normally against the
    -- now-restored fact_order.
    update analytics.stg_order_line_import
      set import_status = 'pending', error_detail = null
      where shop_id = p_shop_id and source_order_no = v_del.source_order_no
        and import_status = 'tombstoned' and fact_order_item_id is null;

    update analytics.fact_order_deleted
      set restored_at = now(), restored_by = auth.uid()
      where id = v_del.id;

    v_restored_ids := array_append(v_restored_ids, v_fo.id);
    v_restored_revenue := v_restored_revenue + coalesce(v_fo.revenue, 0);
    v_restored_count := v_restored_count + 1;
  end loop;

  with affected as (
    select distinct fo3.customer_id
    from analytics.fact_order fo3
    where fo3.id = any (v_restored_ids) and fo3.customer_id is not null
  ),
  agg as (
    select
      a.customer_id,
      (select min(fo4.order_date) from analytics.fact_order fo4 where fo4.shop_id = p_shop_id and fo4.customer_id = a.customer_id)::timestamptz as first_at,
      (select max(fo4.order_date) from analytics.fact_order fo4 where fo4.shop_id = p_shop_id and fo4.customer_id = a.customer_id)::timestamptz as last_at
    from affected a
  )
  update analytics.dim_customer c
  set first_order_at = agg.first_at, last_order_at = agg.last_at, updated_at = now()
  from agg
  where agg.customer_id = c.id
    and (c.first_order_at is distinct from agg.first_at or c.last_order_at is distinct from agg.last_at);

  perform analytics.recompute_is_new_customer(p_shop_id);

  return jsonb_build_object(
    'restored_count', v_restored_count,
    'restored_revenue_thb', v_restored_revenue,
    'restored_ids', to_jsonb(v_restored_ids)
  );
end;
$$;

revoke execute on function analytics.import_restore_orders(uuid, uuid[]) from public, anon, authenticated;
-- H-1: same reasoning as import_delete_orders above.
grant execute on function analytics.import_restore_orders(uuid, uuid[]) to service_role;

-- ============================================================================
-- 3. analytics.transform_pending_order_lines — tombstone-aware (QA gate,
--    12 ก.ย. 69, task brief item 2). Body is byte-identical to the LIVE
--    definition on the DB as of 12 ก.ย. 69 (pulled via pg_get_functiondef,
--    saved at .../scratchpad/transform_pending_order_lines_live.sql — NOT
--    copied from 0041/0094/0109 in this repo, per that file's own warning)
--    except ONE insertion, marked "-- QA gate 12 ก.ย. 69:" below, inside the
--    phase 1 "no matching fact_order" branch.
--
--    Case 2 from the task brief ("re-import ไฟล์รายการสินค้าหลังลบ"): before
--    this fix, a line-item file re-imported for a since-deleted order's
--    source_order_no landed on 'orphan' via the plain "not found" path below
--    — indistinguishable from a genuine "line arrived before its order
--    report" gap, so it re-polluted getOrphanBacklog exactly the way
--    import_delete_orders' own line-status fix (section 0/1 above) was
--    already fixing for the "line was already linked at delete time" case.
--    This closes the other half: lines that only ever show up AFTER the
--    order was deleted.
--
--    Signature/return shape unchanged ((uuid, uuid) -> TABLE(transformed_
--    count, orphan_count, skipped_blank_count, unknown_sku_count, errored_
--    count)) -> plain `create or replace` is correct (3j-migration-traps
--    #1); grants do not survive replace on Supabase -> explicit revoke+
--    grant below (#2).
-- ============================================================================

CREATE OR REPLACE FUNCTION analytics.transform_pending_order_lines(p_shop_id uuid, p_batch_id uuid)
 RETURNS TABLE(transformed_count integer, orphan_count integer, skipped_blank_count integer, unknown_sku_count integer, errored_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_row analytics.stg_order_line_import%rowtype;
  v_item analytics.stg_order_line_import%rowtype;
  v_fo record;
  v_product_id uuid;
  v_unit_cost numeric(12, 2);
  v_category text;
  v_sku_norm text;
  v_stripped_len int;
  v_stripped text;
  v_match_count int;
  v_match_note text;
  v_tier3_conclusive boolean;
  v_weak_order boolean;
  v_new_item_id uuid;
  v_cogs numeric(12, 2);
  v_transformed int := 0;
  v_orphan int := 0;
  v_skipped_blank int := 0;
  v_unknown int := 0;
  v_errored int := 0;
begin
  if p_shop_id is null or p_batch_id is null then
    raise exception 'transform_pending_order_lines: p_shop_id and p_batch_id are required';
  end if;

  for v_row in
    select * from analytics.stg_order_line_import
    where shop_id = p_shop_id and batch_id = p_batch_id and import_status in ('pending', 'orphan', 'error')
    order by source_order_no, line_no
  loop
    begin
      if v_row.sku_raw is null then
        update analytics.stg_order_line_import set import_status = 'skipped_blank', error_detail = null where id = v_row.id;
        v_skipped_blank := v_skipped_blank + 1;
        continue;
      end if;
      if v_row.source_order_no is null then
        update analytics.stg_order_line_import set import_status = 'error', error_detail = 'source_order_no is null on a non-blank SKU row' where id = v_row.id;
        v_errored := v_errored + 1;
        continue;
      end if;
      perform 1 from analytics.fact_order fo where fo.shop_id = p_shop_id and fo.source_order_no = v_row.source_order_no;
      if not found then
        -- QA gate 12 ก.ย. 69: an order with no LIVE fact_order might still
        -- be a deliberately-deleted one, not a genuine orphan (line arrived
        -- before its order report). Check the tombstone BEFORE falling
        -- through to 'orphan' — same precedence 0114 already uses on the
        -- order-header side. Does not increment v_orphan (this is not a
        -- data-quality gap to wait out; it's an expected, permanent state
        -- until/unless the order is restored) and does not overwrite
        -- fact_order_item_id (nothing to link — 'not found' means it was
        -- already null or is being re-set null on a fresh row).
        if exists (
          select 1 from analytics.fact_order_deleted fod
          where fod.shop_id = p_shop_id and fod.source_order_no = v_row.source_order_no and fod.restored_at is null
        ) then
          update analytics.stg_order_line_import set import_status = 'tombstoned', error_detail = 'order deleted (tombstone)' where id = v_row.id;
          continue;
        end if;
        update analytics.stg_order_line_import set import_status = 'orphan', error_detail = 'no fact_order for source_order_no: ' || v_row.source_order_no where id = v_row.id;
        v_orphan := v_orphan + 1;
        continue;
      end if;
      -- 0109: a matching fact_order exists. Promote this row back to
      -- 'pending' if it is currently stuck at 'orphan' or 'error' so phase 2
      -- below (and any subsequent call) can pick it up. Rows already
      -- 'pending' (the normal happy path -- freshly inserted, order already
      -- existed) are left alone by the `is distinct from` guard: no
      -- redundant UPDATE, no behavior change on the path that already
      -- worked.
      if v_row.import_status is distinct from 'pending' then
        update analytics.stg_order_line_import
           set import_status = 'pending', error_detail = null
         where id = v_row.id;
      end if;
    exception when others then
      update analytics.stg_order_line_import set import_status = 'error', error_detail = sqlerrm where id = v_row.id;
      v_errored := v_errored + 1;
    end;
  end loop;

  for v_fo in
    select distinct fo.id as fact_order_id, fo.source_order_no
    from analytics.stg_order_line_import s
    join analytics.fact_order fo on fo.shop_id = p_shop_id and fo.source_order_no = s.source_order_no
    where s.shop_id = p_shop_id and s.batch_id = p_batch_id and s.import_status = 'pending' and s.sku_raw is not null
  loop
    delete from analytics.fact_order_item where fact_order_id = v_fo.fact_order_id;
    v_cogs := 0;
    v_weak_order := false;
    for v_item in
      select * from analytics.stg_order_line_import s
      where s.shop_id = p_shop_id and s.source_order_no = v_fo.source_order_no and s.sku_raw is not null and s.import_status <> 'skipped_blank'
      order by s.line_no
    loop
      begin
        v_product_id := null; v_unit_cost := null; v_category := null; v_match_note := null; v_match_count := null;
        v_tier3_conclusive := false;

        select vp.product_id, vp.effective_unit_cost, vp.category
          into v_product_id, v_unit_cost, v_category
          from analytics.v_dim_product vp
          where vp.shop_id = p_shop_id and vp.is_active and vp.sku = v_item.sku_raw;

        if v_product_id is null then
          v_sku_norm := regexp_replace(v_item.sku_raw, '^[^A-Za-z0-9]+', '');
          v_stripped_len := length(v_item.sku_raw) - length(v_sku_norm);
          v_stripped := left(v_item.sku_raw, v_stripped_len);

          if v_sku_norm <> '' and v_stripped_len <= 2 and v_sku_norm ~ '[A-Za-z]'
             and (v_stripped_len = 0 or v_stripped !~ '[[:alpha:]]') then
            select sub.product_id, sub.effective_unit_cost, sub.category, sub.cnt
              into v_product_id, v_unit_cost, v_category, v_match_count
              from (
                select vp.product_id, vp.effective_unit_cost, vp.category,
                       count(*) over () as cnt
                  from analytics.v_dim_product vp
                  where vp.shop_id = p_shop_id and vp.is_active
                    and regexp_replace(vp.sku, '^[^A-Za-z0-9]+', '') = v_sku_norm
                  limit 1
              ) sub;

            if v_match_count = 1 then
              v_match_note := 'จับคู่ด้วยรหัสที่ตัดอักขระนำหน้า: ' || v_item.sku_raw || ' -> ' || v_sku_norm;
            else
              if coalesce(v_match_count, 0) = 0 then
                v_tier3_conclusive := true;
              end if;
              v_product_id := null; v_unit_cost := null; v_category := null;
            end if;
          end if;
        end if;

        if v_product_id is null then
          select sub.product_id, sub.effective_unit_cost, sub.category, sub.cnt
            into v_product_id, v_unit_cost, v_category, v_match_count
            from (
              select vp.product_id, vp.effective_unit_cost, vp.category,
                     count(*) over () as cnt
                from analytics.v_dim_product vp
                where vp.shop_id = p_shop_id and not vp.is_active and vp.sku = v_item.sku_raw
                limit 1
            ) sub;

          if v_match_count = 1 then
            if v_tier3_conclusive then
              v_match_note := 'จับคู่กับสินค้าที่ปิดการขาย (ใช้ต้นทุนเดิม): ' || v_item.sku_raw;
            else
              v_match_note := 'จับคู่กับสินค้าที่ปิดการขาย (ใช้ต้นทุนเดิม) — ยังพิสูจน์ไม่ได้ว่าไม่มีคู่แฝดที่ยังขายอยู่ — ต้องตรวจมือ: ' || v_item.sku_raw;
              v_weak_order := true;
            end if;
          else
            v_product_id := null; v_unit_cost := null; v_category := null;
          end if;
        end if;

        if v_product_id is null then
          v_unknown := v_unknown + 1;
          v_weak_order := true;
          v_match_note := 'ไม่พบสินค้าในระบบ ต้นทุนถูกนับเป็น 0: ' || v_item.sku_raw;
        end if;
        if v_category = 'เงินแท่ง' then
          v_unit_cost := round(coalesce(v_item.unit_price, 0) / 1.2, 2);
        end if;
        insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, product_name_snapshot, qty, unit_price, unit_cost_snapshot)
        values (p_shop_id, v_fo.fact_order_id, v_product_id, v_item.sku_raw, v_item.product_name_raw, coalesce(v_item.qty, 1), coalesce(v_item.unit_price, 0), v_unit_cost)
        returning id into v_new_item_id;
        update analytics.stg_order_line_import set fact_order_item_id = v_new_item_id, import_status = 'transformed', error_detail = v_match_note where id = v_item.id;
        v_transformed := v_transformed + 1;
        v_cogs := v_cogs + coalesce(v_item.qty, 1) * coalesce(v_unit_cost, 0);
      exception when others then
        update analytics.stg_order_line_import set import_status = 'error', error_detail = sqlerrm where id = v_item.id;
        v_errored := v_errored + 1;
        v_weak_order := true;
      end;
    end loop;
    update analytics.fact_order
       set cogs = v_cogs,
           profit = round(revenue - v_cogs, 2),
           profit_status = case when v_weak_order then 'estimated' else 'actual' end::analytics.profit_status_t
     where id = v_fo.fact_order_id;
  end loop;

  return query select v_transformed, v_orphan, v_skipped_blank, v_unknown, v_errored;
end;
$function$;

revoke execute on function analytics.transform_pending_order_lines(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.transform_pending_order_lines(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
