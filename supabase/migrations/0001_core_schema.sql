-- 0001_core_schema.sql
-- OMS Phase 2 batch 1 — core schema per docs/phase1-design.md §1 + Appendix A.
-- Creation order follows the design's stated dependency chain:
--   enums -> shop/member -> channel/carrier -> channel_account -> product ->
--   product_mapping -> central_stock -> stock_ledger -> orders -> order_item ->
--   shipment -> sync_job
--
-- NOTE (deviation from literal Appendix A ordering, documented per task instructions):
-- `product_mapping` is not named in the Appendix A ordering sentence even though it
-- is part of the §1 ER model. It is created right after `product` (its only
-- dependencies — product + channel_account — already exist by then).
-- `stock_ledger.order_id` references `orders`, which is created *after* stock_ledger
-- in the design's stated order — the FK is added via ALTER TABLE once `orders`
-- exists further down in this same file/transaction.

create extension if not exists pgcrypto;

-- ============================================================================
-- ENUMS
-- ============================================================================

create type shop_member_role as enum ('owner', 'admin', 'staff');

create type channel_account_status as enum ('active', 'disabled', 'error');

-- Order state machine per design §3.
create type order_status as enum (
  'new', 'confirmed', 'to_ship', 'shipped', 'completed', 'oversold_hold', 'cancelled'
);

-- Per design D3: kept as a real enum (not a CHECK list) specifically so `return_in`
-- can be added later with `ALTER TYPE stock_move_type ADD VALUE 'return_in'`
-- without a breaking migration. Return/refund logic itself is NOT implemented
-- in this batch (D3: "Phase หลัง").
create type stock_move_type as enum ('reserve', 'release', 'commit', 'adjustment');

create type shipment_label_source as enum ('marketplace', 'direct_api', 'manual');

create type shipment_status as enum (
  'pending', 'label_created', 'picked_up', 'in_transit', 'delivered', 'failed'
);

create type sync_job_type as enum (
  'pull_orders', 'push_stock', 'confirm_shipment', 'process_webhook', 'release_expired_reservations'
);

-- 'failed' is intentionally not a persisted status: a retryable failure goes back
-- to 'queued' with a future run_at (exponential backoff); only a terminal failure
-- (attempts >= max_attempts) becomes 'dead'. See 0003 / sync-worker.
create type sync_job_status as enum ('queued', 'processing', 'done', 'dead');

-- ============================================================================
-- shared trigger helpers
-- ============================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- shop / shop_member
-- ============================================================================

create table shop (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_shop_updated_at
  before update on shop
  for each row execute function set_updated_at();

create table shop_member (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shop (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role shop_member_role not null default 'staff',
  created_at timestamptz not null default now(),
  constraint uq_shop_member unique (shop_id, user_id)
);

create index idx_shop_member_user_id on shop_member (user_id);

-- ============================================================================
-- channel / carrier (reference tables — INSERT to add new marketplace/carrier,
-- no migration needed per design decision)
-- ============================================================================

create table channel (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_channel_updated_at
  before update on channel
  for each row execute function set_updated_at();

create table carrier (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_carrier_updated_at
  before update on carrier
  for each row execute function set_updated_at();

-- ============================================================================
-- channel_account (shop's connection to a channel)
-- ============================================================================

create table channel_account (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shop (id) on delete cascade,
  channel_id uuid not null references channel (id) on delete restrict,
  external_shop_id text not null,
  -- Secret material never lives in this table — this only points into
  -- Supabase Vault (design decision, §1). Rotation/encryption owned by security-auditor.
  credential_ref text,
  is_sandbox boolean not null default false,
  -- D1: unpaid reservations auto-release after this TTL. Nullable = fall back to the
  -- 48h platform default (see release_expired_reservations() in 0003).
  -- DECISION: design text says TTL is "settable per channel" but `channel` is a
  -- shared reference table across all shops, so a shop-specific override there
  -- would leak between tenants. The override lives on channel_account instead
  -- (shop's own connection), with COALESCE(..., 48) as the global fallback.
  reserve_ttl_hours integer check (reserve_ttl_hours is null or reserve_ttl_hours > 0),
  status channel_account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_channel_account unique (shop_id, channel_id, external_shop_id)
);

create index idx_channel_account_shop_id on channel_account (shop_id);
create index idx_channel_account_channel_id on channel_account (channel_id);

create trigger trg_channel_account_updated_at
  before update on channel_account
  for each row execute function set_updated_at();

-- ============================================================================
-- product
-- ============================================================================

create table product (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shop (id) on delete cascade,
  sku text not null,
  name text not null,
  barcode text,
  unit_cost numeric(12, 2) check (unit_cost is null or unit_cost >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_product_shop_sku unique (shop_id, sku)
);

create index idx_product_shop_id on product (shop_id);

create trigger trg_product_updated_at
  before update on product
  for each row execute function set_updated_at();

-- ============================================================================
-- product_mapping (master SKU <-> channel_account's external item)
-- ============================================================================

create table product_mapping (
  id uuid primary key default gen_random_uuid(),
  -- shop_id is derived (trigger below), never set directly by the app —
  -- defense-in-depth so a bug can't map a product into another tenant's RLS view.
  shop_id uuid not null references shop (id) on delete cascade,
  product_id uuid not null references product (id) on delete cascade,
  channel_account_id uuid not null references channel_account (id) on delete cascade,
  external_item_id text not null,
  external_sku text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_product_mapping_channel_item unique (channel_account_id, external_item_id),
  -- Phase 1 scope (§7): no bundle/combo SKU -> at most one mapping per
  -- (product, channel_account).
  constraint uq_product_mapping_product_channel unique (product_id, channel_account_id)
);

create index idx_product_mapping_product_id on product_mapping (product_id);
create index idx_product_mapping_channel_account_id on product_mapping (channel_account_id);

create or replace function sync_product_mapping_shop_id()
returns trigger
language plpgsql
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

create trigger trg_product_mapping_shop_id
  before insert or update of product_id, channel_account_id on product_mapping
  for each row execute function sync_product_mapping_shop_id();

create trigger trg_product_mapping_updated_at
  before update on product_mapping
  for each row execute function set_updated_at();

-- ============================================================================
-- central_stock (design §1: one row per product, PK = product_id — single
-- warehouse per shop for Phase 1, §7)
-- ============================================================================

create table central_stock (
  product_id uuid primary key references product (id) on delete cascade,
  -- derived from product (trigger below) — never set directly by the app.
  shop_id uuid not null references shop (id) on delete cascade,
  qty_on_hand integer not null default 0,
  qty_reserved integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint chk_central_stock_non_negative check (qty_on_hand >= 0 and qty_reserved >= 0),
  -- Wall #2 of the 3-layer oversell defense (design §2): even a buggy caller
  -- that bypasses the RPC's conditional UPDATE cannot push this past on_hand.
  constraint chk_central_stock_reserved_le_on_hand check (qty_reserved <= qty_on_hand)
);

create index idx_central_stock_shop_id on central_stock (shop_id);

create or replace function sync_central_stock_shop_id()
returns trigger
language plpgsql
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

create trigger trg_central_stock_shop_id
  before insert or update of product_id on central_stock
  for each row execute function sync_central_stock_shop_id();

create trigger trg_central_stock_updated_at
  before update on central_stock
  for each row execute function set_updated_at();

-- ============================================================================
-- stock_ledger (append-only audit — design §1/§2)
-- ============================================================================

create table stock_ledger (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shop (id) on delete cascade,
  -- ON DELETE RESTRICT (not CASCADE): the audit trail must survive even if a
  -- product row is ever hard-deleted — shops are expected to soft-delete
  -- (product.is_active = false) instead.
  product_id uuid not null references product (id) on delete restrict,
  -- FK to orders added further down via ALTER TABLE, see header note.
  order_id uuid,
  move_type stock_move_type not null,
  qty integer not null check (qty > 0),
  reserved_delta integer not null,
  on_hand_delta integer not null,
  -- Resulting balances captured in the same transaction as the stock UPDATE —
  -- gives a self-contained audit row without needing to replay history.
  qty_on_hand_after integer not null check (qty_on_hand_after >= 0),
  qty_reserved_after integer not null check (qty_reserved_after >= 0),
  -- Composed as `{caller idem_key}:{product_id}` by the RPCs in 0003 — see the
  -- note there on why the literal design constraint UNIQUE(shop_id, idem_key)
  -- needs a per-product suffix to support multi-item orders.
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint uq_stock_ledger_idem unique (shop_id, idempotency_key)
);

create index idx_stock_ledger_product_id on stock_ledger (product_id, created_at);
create index idx_stock_ledger_order_id on stock_ledger (order_id);

-- ============================================================================
-- orders / order_item
-- ============================================================================

create table orders (
  id uuid primary key default gen_random_uuid(),
  -- derived from channel_account (trigger below) — never set directly by the app.
  shop_id uuid not null references shop (id) on delete cascade,
  channel_account_id uuid not null references channel_account (id) on delete restrict,
  external_order_id text not null,
  status order_status not null default 'new',
  -- raw marketplace status, kept verbatim to compare against (design §3).
  external_status text not null default '',
  buyer_name text,
  buyer_phone text,
  shipping_address jsonb,
  total_amount numeric(12, 2) not null default 0 check (total_amount >= 0),
  currency text not null default 'THB',
  cancel_reason text,
  placed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Idempotency layer 2 of 3 (design §4).
  constraint uq_orders_channel_account_external unique (channel_account_id, external_order_id)
);

create index idx_orders_shop_status on orders (shop_id, status);
create index idx_orders_channel_account on orders (channel_account_id);

create or replace function sync_orders_shop_id()
returns trigger
language plpgsql
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

create trigger trg_orders_shop_id
  before insert or update of channel_account_id on orders
  for each row execute function sync_orders_shop_id();

create trigger trg_orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

-- Design §3: "Transition validate ใน DB trigger (กัน webhook มาสลับลำดับเขียนสถานะถอยหลัง)".
-- DECISION: oversold_hold -> new is allowed as an admin recovery path (D2: manual
-- review may re-map a substitute SKU and re-attempt reservation) — not explicitly
-- in the design's transition table, but required for D2 ("หาของทดแทน") to be
-- actionable at all. Flagged here since it's an addition beyond the literal spec.
create or replace function validate_order_status_transition()
returns trigger
language plpgsql
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

create trigger trg_validate_order_status_transition
  before update of status on orders
  for each row execute function validate_order_status_transition();

create table order_item (
  id uuid primary key default gen_random_uuid(),
  -- derived from orders (trigger below) — never set directly by the app.
  shop_id uuid not null references shop (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  -- Nullable: an order can arrive with a marketplace SKU that has no
  -- product_mapping yet -> order transitions to oversold_hold (§3) until an
  -- admin maps it and this column gets backfilled.
  product_id uuid references product (id) on delete restrict,
  external_item_id text not null,
  external_sku text,
  qty integer not null check (qty > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_order_item_order_external unique (order_id, external_item_id)
);

create index idx_order_item_order_id on order_item (order_id);
create index idx_order_item_product_id on order_item (product_id);

create or replace function sync_order_item_shop_id()
returns trigger
language plpgsql
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

create trigger trg_order_item_shop_id
  before insert or update of order_id on order_item
  for each row execute function sync_order_item_shop_id();

create trigger trg_order_item_updated_at
  before update on order_item
  for each row execute function set_updated_at();

-- Now that `orders` exists, wire up the deferred FK from stock_ledger (header note).
alter table stock_ledger
  add constraint fk_stock_ledger_order foreign key (order_id) references orders (id) on delete set null;

-- ============================================================================
-- shipment (1 order -> many packages; label can come from either the
-- marketplace or a direct carrier API — design §1)
-- ============================================================================

create table shipment (
  id uuid primary key default gen_random_uuid(),
  -- derived from orders (trigger below) — never set directly by the app.
  shop_id uuid not null references shop (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  carrier_id uuid references carrier (id) on delete restrict,
  label_source shipment_label_source not null,
  tracking_no text,
  label_url text,
  status shipment_status not null default 'pending',
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_shipment_order_id on shipment (order_id);
create index idx_shipment_carrier_id on shipment (carrier_id);

create or replace function sync_shipment_shop_id()
returns trigger
language plpgsql
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

create trigger trg_shipment_shop_id
  before insert or update of order_id on shipment
  for each row execute function sync_shipment_shop_id();

create trigger trg_shipment_updated_at
  before update on shipment
  for each row execute function set_updated_at();

-- ============================================================================
-- sync_job (pg-backed queue — design §4)
-- ============================================================================

create table sync_job (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shop (id) on delete cascade,
  channel_account_id uuid references channel_account (id) on delete cascade,
  job_type sync_job_type not null,
  payload jsonb not null default '{}'::jsonb,
  idem_key text not null,
  status sync_job_status not null default 'queued',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Idempotency layer 1 of 3 (design §4).
  constraint uq_sync_job_type_idem unique (job_type, idem_key)
);

-- Supports the worker's claim query: WHERE status = 'queued' AND run_at <= now()
-- ORDER BY run_at ... FOR UPDATE SKIP LOCKED.
create index idx_sync_job_claim on sync_job (status, run_at);
create index idx_sync_job_shop_id on sync_job (shop_id);

create trigger trg_sync_job_updated_at
  before update on sync_job
  for each row execute function set_updated_at();

-- ============================================================================
-- Seed data
-- ============================================================================

-- Batch scope explicitly limits seeded channels to shopee + tiktok (per task
-- instructions) — lazada is fully speced in the design (§5) but its connector
-- is deferred to a later batch; INSERT-only to add it later (no migration).
insert into channel (code, name) values
  ('shopee', 'Shopee'),
  ('tiktok', 'TikTok Shop')
on conflict (code) do nothing;

insert into carrier (code, name) values
  ('kerry', 'Kerry Express'),
  ('flash', 'Flash Express'),
  ('thailand_post', 'ไปรษณีย์ไทย'),
  ('jnt', 'J&T Express')
on conflict (code) do nothing;
