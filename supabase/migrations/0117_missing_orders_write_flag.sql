-- 0117_missing_orders_write_flag.sql
-- DB-level kill switch for the cancel-detection write path (analytics.
-- import_delete_orders / analytics.import_restore_orders, 0115), built at
-- security's (Mace) standing condition on 0115's own review: "ถ้าจะเปิดปุ่ม
-- ลบ ต้องมีสวิตช์ปิดใน DB ก่อน" — see 0115's header §H-1 and lib/actions/
-- import-missing-orders.ts's "Known debt" note (both point here). Owner
-- mandate to actually open the button landed 14 ก.ย. 69 (mission brief
-- "มติ C-2") — this migration is the switch that mandate is conditioned on,
-- not the UI change itself (that's a separate, TS-only follow-up).
--
-- ⚠️ PREPARED, NOT APPLIED — this file is written to be reviewed and applied
-- by the owner via the Supabase MCP (supabase-migrate skill: pre-check →
-- apply_migration → self-verify → get_advisors). Do not run this against a
-- live project as part of writing it. Rehearsal: scripts/verify-0117-
-- write-gate.sql (dry-run in a transaction that always rolls back, per
-- 3j-migration-traps #11 — this touches analytics.fact_order for real,
-- if only inside a transaction that never commits).
--
-- Why a DB table, not just "check env var inside the RPC": production
-- (oms-3j.vercel.app) has no login and is intentionally open to the public
-- (accepted risk, memory/prod-exposure-accepted-risk) — the ONLY gate on
-- these two RPCs until Auth A2 ships is whatever this migration adds.
-- process.env.MISSING_ORDERS_WRITE_ENABLED (the gate it replaces, TS-side,
-- lib/actions/import-missing-orders.ts) had two independent problems: (1)
-- on Vercel, changing an env var needs a REDEPLOY to take effect — not a
-- real kill switch if something goes wrong mid-incident; (2) it lives in
-- TypeScript, so it does nothing at all against a caller who already holds
-- the service_role key and calls the RPC directly over PostgREST/psql,
-- bypassing the Next.js server action (and therefore the env check)
-- entirely. A row in this table is read fresh on every call, inside the
-- SAME security definer function that does the deleting/restoring — no
-- redeploy, no way to route around it short of the service_role key AND
-- DB access, at which point the RPC's own gate is the last thing standing
-- between a mistake/compromised key and permanently deleting revenue rows.
--
-- No row = closed (fail closed, not fail open) — deliberately NOT seeding
-- any row for any shop here. Opening the gate for 3J Jewelry's real shop_id
-- is a separate, explicit statement the owner runs after reviewing this
-- migration, not something this file does on its behalf:
--   insert into analytics.crm_feature_flag (shop_id, flag, enabled)
--   values ('<shop_id>', 'missing_orders_write', true)
--   on conflict (shop_id, flag) do update set enabled = true, updated_at = now();
-- and closing it again is the same statement with enabled = false — no
-- migration, no redeploy, no MCP round-trip needed for either direction
-- once this table exists.
--
-- Table is schema-generic on purpose (flag text, not a boolean column named
-- for this one feature) — analytics.crm_feature_flag is meant to be reused
-- for the next "DB kill switch" this project needs, not re-built per
-- feature. RLS: owner/admin of the shop can SELECT their own shop's flags
-- (so a future "show switch status" UI never needs the service-role
-- client just to read this) — no INSERT/UPDATE/DELETE policy for
-- authenticated at all, matching this project's existing pattern of no
-- table-level RLS write policy for CRM writes (0021 §7's own note): writes
-- to this table happen from the SQL editor / MCP by the owner directly
-- (service_role), never from the app.
-- ============================================================================

create table if not exists analytics.crm_feature_flag (
  shop_id uuid not null references public.shop (id) on delete cascade,
  flag text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (shop_id, flag)
);

alter table analytics.crm_feature_flag enable row level security;

-- `create policy` (no `if not exists` support in Postgres for policies) —
-- guarded with `drop policy if exists` first so this stays safe to replay,
-- matching the rest of this project's RLS migrations.
drop policy if exists owner_admin_select on analytics.crm_feature_flag;
create policy owner_admin_select on analytics.crm_feature_flag for select
  using (shop_id in (select shop_id from public.shop_member
                     where user_id = auth.uid() and role in ('owner','admin')));

grant select on analytics.crm_feature_flag to authenticated;
grant all    on analytics.crm_feature_flag to service_role;

-- ============================================================================
-- analytics.import_delete_orders / analytics.import_restore_orders —
-- create-or-replace with the gate inserted. Bodies below are byte-identical
-- to the LIVE definitions (supabase/migrations/0115_import_delete_restore.sql,
-- the current live definition — nothing has replaced it since) EXCEPT the
-- one block each marked "-- 0117", inserted immediately after `perform
-- analytics.crm_require_owner_admin(p_shop_id);`. Signatures are UNCHANGED
-- ((uuid,uuid,uuid[],text) and (uuid,uuid[]) respectively) — plain `create
-- or replace` is correct here (3j-migration-traps #1: an arg-list change
-- would silently create an overload instead of replacing, this does not
-- change the arg list). Grants do NOT survive `create or replace` on
-- Supabase (3j-migration-traps #2) — both functions get their revoke+grant
-- re-stated below, same as 0115 already did for them.
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
  v_cascade_tables text[];
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  -- 0117 (security review 12 ก.ย. 69, C-2 follow-up + owner mandate "เปิดปุ่ม
  -- ลบได้เลย", 14 ก.ย. 69) — DB-level kill switch. Placed IMMEDIATELY after
  -- the owner/admin check above (not before it) so a non-owner/non-admin
  -- caller still only ever sees "not owner/admin" and never learns this
  -- feature/gate exists at all — and BEFORE every other validation below,
  -- so a closed gate rejects on the very first thing this function does
  -- regardless of what else is wrong with the call. No row for
  -- (p_shop_id, 'missing_orders_write') = closed by default (fail closed,
  -- not fail open) — this is the real, DB-side enforcement the TS-only env
  -- gate (removed from lib/actions/import-missing-orders.ts this same
  -- migration) could never provide on Vercel: flipping this row takes
  -- effect on the very next call, no redeploy, and it also closes the door
  -- on a caller holding the service_role key who calls this RPC directly
  -- (PostgREST/psql), bypassing the Next.js server action entirely.
  if not coalesce((select f.enabled from analytics.crm_feature_flag f
                   where f.shop_id = p_shop_id and f.flag = 'missing_orders_write'), false) then
    raise exception 'import_delete_orders: write gate closed for this shop'
      using errcode = 'P0001', detail = 'write_gate_closed';
  end if;

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

  -- security review C-1 guard (12 ก.ย. 69, tightened Low-priority follow-up
  -- same day): the snapshot below covers exactly 3 tables whose ON DELETE
  -- CASCADE points at analytics.fact_order (dim_address, fact_order_item,
  -- crm_order_override — confirmed against pg_constraint on the live DB).
  -- Compares the actual TABLE NAMES, not just a count of 3 — a plain count
  -- would stay "3" and pass silently even if one of these three lost its
  -- cascade FK while an unrelated 4th table gained one, which is exactly
  -- the kind of change this guard exists to catch. Schema-qualified via an
  -- explicit pg_namespace join (not ::regclass::text, which renders
  -- unqualified for anything already resolvable through search_path —
  -- 'analytics' is in this function's own search_path, so that shortcut
  -- would have silently produced bare table names here). Runs on every
  -- call, not just once, so it stays correct even if this function is
  -- never touched again.
  select coalesce(array_agg(n.nspname || '.' || cl.relname order by n.nspname, cl.relname), '{}')
    into v_cascade_tables
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f' and c.confdeltype = 'c'
      and c.confrelid = 'analytics.fact_order'::regclass;
  if v_cascade_tables is distinct from array['analytics.crm_order_override', 'analytics.dim_address', 'analytics.fact_order_item'] then
    raise exception 'import_delete_orders: expected ON DELETE CASCADE foreign keys into analytics.fact_order from exactly {analytics.crm_order_override, analytics.dim_address, analytics.fact_order_item} but found {%} — the snapshot/restore logic in this function does not necessarily cover all cascading tables anymore; refusing to delete anything until this is reconciled',
      array_to_string(v_cascade_tables, ', ');
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
  -- crm_order_override (all ON DELETE CASCADE per 0010/0021 — see the
  -- v_cascade_tables guard above), and ON DELETE SET NULLs stg_order_
  -- import.fact_order_id (already tombstoned above) and, transitively via
  -- fact_order_item's own cascade, stg_order_line_import.fact_order_item_id
  -- (already marked tombstoned above, not 'orphan' — QA gate 12 ก.ย. 69).
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
-- analytics.import_restore_orders
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

  -- 0117 — same DB-level kill switch as import_delete_orders above (see that
  -- function's own comment for the full reasoning). Restore is just as
  -- destructive to trust in the data as delete (it un-deletes revenue rows
  -- with a re-derived customer link) so it is gated identically, checked at
  -- the same position (right after the owner/admin check, before every
  -- other validation).
  if not coalesce((select f.enabled from analytics.crm_feature_flag f
                   where f.shop_id = p_shop_id and f.flag = 'missing_orders_write'), false) then
    raise exception 'import_restore_orders: write gate closed for this shop'
      using errcode = 'P0001', detail = 'write_gate_closed';
  end if;

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

    -- QA gate (12 ก.ย. 69) + security fix M-a (12 ก.ย. 69): stg_line_links
    -- (above) only covers line rows that were ALREADY linked to a
    -- fact_order_item at delete time. A line report re-imported WHILE this
    -- order was tombstoned lands at import_status='tombstoned' with
    -- fact_order_item_id still null (see transform_pending_order_lines
    -- below) — those rows have no entry in stg_line_links at all, so the
    -- loop above never touches them.
    --
    -- 🔴 M-a: 'pending' was the WRONG target status here. transform_
    -- pending_order_lines only ever re-scans rows scoped to a SPECIFIC
    -- batch_id it was called with (`where ... batch_id = p_batch_id and
    -- import_status in ('pending','orphan','error')`) — nothing in this
    -- codebase re-transforms an arbitrary old batch on a schedule, and
    -- analytics.v_orphan_line_backlog only surfaces 'orphan' rows. A row
    -- left at 'pending' is therefore invisible to BOTH the retry path and
    -- the backlog UI: it would sit there silently forever, and the
    -- restored order would carry an understated cogs/overstated profit with
    -- no signal to the owner that an item is missing.
    --
    -- 'orphan' fixes both: transform_pending_order_lines' phase 1 already
    -- treats 'orphan' the same as 'pending' (same `in (...)` list) so it
    -- still self-heals the next time ITS OWN batch is re-transformed, AND
    -- it shows up in v_orphan_line_backlog / getOrphanBacklog as soon as
    -- this transaction commits — correctly, since that view excludes by
    -- "active (restored_at is null) tombstone for this source_order_no",
    -- and this same function sets restored_at on that tombstone a few lines
    -- below (statement order within the transaction doesn't matter here:
    -- both changes land together atomically at commit, so any reader after
    -- this function returns sees the row as both 'orphan' AND no-longer-
    -- excluded, never one without the other).
    update analytics.stg_order_line_import
      set import_status = 'orphan', error_detail = 'order restored — line needs re-transform'
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

notify pgrst, 'reload schema';
