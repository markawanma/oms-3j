-- 0112_fact_order_deleted.sql
-- Cancel-detection Phase 1 (design: Yoda, 11 ก.ย. 69 — "ตรวจจับ + ลบออเดอร์ที่
-- ถูกยกเลิก") — this file only adds the enum value + the tombstone/history
-- table + its indexes + RLS. No function in THIS file uses the new enum
-- value or writes to this table yet (0113/0114/0115 do that) — kept
-- deliberately separate per 3j-migration-traps: `alter type ... add value`
-- cannot be used inside the same transaction that adds it, so it must live
-- in its own migration ahead of anything that references 'tombstoned'.
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

-- ============================================================================
-- 1. New import_status value: 'tombstoned' — a stg_order_import row whose
--    matching fact_order was deleted via the missing-orders flow lands here
--    (0114 wires the check into transform_pending_orders; NOT used in this
--    file). Added to the existing shared enum (not a new text-check column)
--    because stg_order_import.import_status already IS this enum type
--    (0010:51-53) and every other status on that column already lives here.
-- ============================================================================

alter type analytics.import_status_t add value if not exists 'tombstoned';

-- ============================================================================
-- 2. analytics.fact_order_deleted — one row per deleted order (design §2).
--    Physical delete + full snapshot, not a soft-delete flag: the design
--    brief's explicit reasoning is that a soft-delete boolean would require
--    touching every existing view/mart that reads analytics.fact_order (crm
--    overview, dashboard_summary, tiktok dashboards, ...) to add a
--    `where not is_deleted` filter everywhere — one missed spot silently
--    keeps counting a cancelled order. A physical delete makes every
--    existing reader correct for free; this table is the only place that
--    remembers what was removed and why, so it can be undone.
--
--    fact_order_id has NO foreign key on purpose (per design §2): once the
--    order is deleted the id no longer exists in analytics.fact_order at
--    all (not until/unless restored), so an FK here would either block the
--    delete or force ON DELETE SET NULL and lose the very id restore needs.
--    It is still NOT NULL — every row in this table refers to exactly one
--    order that definitely existed at delete time.
-- ============================================================================

create table analytics.fact_order_deleted (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,

  fact_order_id uuid not null, -- no FK — see header comment
  source_order_no text not null,
  channel_id uuid not null references analytics.dim_channel (id) on delete restrict,
  order_date date not null references analytics.dim_date (date_key),
  revenue numeric(12, 2) not null check (revenue >= 0),
  customer_id uuid references analytics.dim_customer (id) on delete set null,

  -- full snapshots — restore reconstructs the row via
  -- jsonb_populate_record(null::analytics.fact_order, order_row), so this
  -- must be to_jsonb() of the WHOLE fact_order row, not a hand-picked subset.
  order_row jsonb not null,
  item_rows jsonb not null default '[]'::jsonb,
  override_row jsonb,
  -- security review C-1 (12 ก.ย. 69): analytics.dim_address also ON DELETE
  -- CASCADEs from fact_order_id (0010:441) and was NOT being snapshotted —
  -- deleting an order with a saved shipping address silently threw the
  -- address away forever, and restore could never bring it back. Same
  -- "to_jsonb() of the whole row, restore via jsonb_populate_record" shape
  -- as item_rows. Default '[]' because most historical fact_order rows
  -- predate dim_address parsing and have zero rows here, same as item_rows.
  address_rows jsonb not null default '[]'::jsonb,

  -- staging lineage, captured BEFORE the delete severs it (fact_order's
  -- delete cascades to fact_order_item, which ON DELETE SET NULLs
  -- stg_order_line_import.fact_order_item_id — and the fact_order delete
  -- itself ON DELETE SET NULLs stg_order_import.fact_order_id, per 0010/0041).
  -- Without capturing these first, restore would have no way to know which
  -- staging rows to re-link.
  stg_order_import_ids uuid[] not null default '{}',
  stg_line_links jsonb not null default '[]'::jsonb, -- [{stg_order_line_import_id, fact_order_item_id}, ...]

  detected_by_batch_id uuid references analytics.stg_import_batch (id) on delete set null,
  detected_by_file_name text,

  -- {prefix, lo, hi, date_lo, date_hi, channels, file_order_count,
  --  candidate_count} — the SPECIFIC prefix-group evidence that flagged this
  -- one order as missing, not the whole batch's multi-group evidence (that
  -- shape lives only in import_missing_orders' jsonb response, never stored).
  evidence jsonb not null,

  reason text not null check (btrim(reason) <> ''),
  deleted_by uuid references auth.users (id) on delete set null, -- null until Auth A2 (service_role calls have no auth.uid())
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid references auth.users (id) on delete set null
  -- no restored_at/restored_by pairing CHECK: restored_by is null until Auth
  -- A2 same as deleted_by (service_role calls have no auth.uid()), so a
  -- restored row with restored_at set + restored_by still null is expected,
  -- not corrupt.
);

-- A given order can only have ONE *active* (not-yet-restored) tombstone at a
-- time — once restored, a fresh delete of the same source_order_no is free
-- to create a new row (old one stays as history, restored_at stamped).
create unique index uq_fact_order_deleted_shop_source_active
  on analytics.fact_order_deleted (shop_id, source_order_no)
  where restored_at is null;

create index idx_fact_order_deleted_shop_deleted_at
  on analytics.fact_order_deleted (shop_id, deleted_at desc);

create index idx_fact_order_deleted_batch
  on analytics.fact_order_deleted (detected_by_batch_id);

-- ============================================================================
-- 3. RLS — Tier 4 pattern (0012/0021/0023): owner/admin SELECT only, no
--    insert/update/delete policy at all. The only write path is the
--    SECURITY DEFINER RPCs in 0115 (import_delete_orders / import_restore_
--    orders), which run as the function owner and bypass RLS — same
--    "no direct write policy" shape as analytics.crm_order_override (0021)
--    and analytics.stg_import_batch's service-role-only siblings.
-- ============================================================================

alter table analytics.fact_order_deleted enable row level security;

create policy owner_admin_select on analytics.fact_order_deleted
  for select
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- Table-level grants — RLS policies alone do nothing without these (the
-- policy filters ROWS, the grant is what lets the role touch the table at
-- all). Missed in the original draft of this migration; found by security
-- review 12 ก.ย. 69 by diffing against the sibling table this one's RLS
-- shape was copied from (analytics.crm_order_override, 0021): authenticated
-- SELECT (the owner_admin_select policy above still restricts which rows),
-- service_role ALL (every write here goes through 0115's SECURITY DEFINER
-- RPCs, which run as the function owner and so do not strictly need this
-- table grant themselves — but getDeletedOrders (lib/actions/import-
-- missing-orders.ts) reads this table directly via getServiceClient(),
-- which needs it). Without the authenticated grant, getDeletedOrders would
-- 42501 the moment a real (non-service-role) session ever queries this
-- table directly instead of through the service client.
grant select on analytics.fact_order_deleted to authenticated;
grant all on analytics.fact_order_deleted to service_role;

notify pgrst, 'reload schema';
