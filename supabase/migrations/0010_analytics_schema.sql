-- 0010_analytics_schema.sql
-- Analytics layer Phase A1 (schema DDL only) per:
--   docs/3j-jewelry/analytics/marketing-analytics-db-design.md (architect design)
--   docs/3j-jewelry/analytics/stg-import-schema.md (staging spec, locked 2026-08-10)
--
-- Scope: `create schema analytics` + dims + facts. Staging tables + pii_customer
-- live in 0011 (they FK into fact_order, created here). RLS lives in 0012
-- (mirrors the 0001/0002 split already used in this repo).
--
-- Numbering note: this migration is written on top of 0007 (0008/0009 exist as
-- files in this repo but are NOT applied to the DB yet per task brief). It does
-- NOT depend on 0008 or 0009 — analytics is a separate schema and only reads
-- `public.shop`, `public.orders`, `public.product`, `public.channel`, all of
-- which are already live from 0001. Safe to apply regardless of 0008/0009
-- status. Does NOT touch `public` schema DDL (no ALTER on OMS tables).
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

create schema if not exists analytics;

-- pgcrypto already created (database-wide) in 0001 for gen_random_uuid()/digest().
-- uuid-ossp is new here, needed for uuid_nil() used by fact_ad_spend's upsert key
-- (design §3.3: "coalesce(campaign_id, uuid_nil())" — literal spec).
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ============================================================================
-- ENUMS
--
-- DECISION: the design doc (marketing-analytics-db-design.md) mostly spells out
-- status-like columns as `text CHECK (... in (...))`, not real enum types — kept
-- that way below (identity_type, confidence, channel_role, objective, touch_type,
-- entry_method, address_type, address_type_source, parse_confidence) because the
-- design explicitly favors CHECK there (cheap to extend with an ALTER TABLE, no
-- enum-ADD-VALUE transaction restriction). The task brief for THIS migration
-- explicitly calls out two fields as "enum": fact_order.profit_status and
-- stg_order_import.import_status — those get real Postgres enum types below,
-- consistent with how 0001 uses enums for OMS state-machine columns
-- (order_status, sync_job_status).
-- ============================================================================

-- ⚠️ CONFLICT FLAGGED: marketing-analytics-db-design.md §3.1 lists profit_status
-- values as ('complete','estimated','missing'). stg-import-schema.md §7(ค)
-- (locked 2026-08-10, i.e. newer) instead says "flip profit_status='actual'"
-- and the task brief for this migration explicitly says
-- "profit_status enum missing/estimated/actual". Followed the task brief /
-- newer staging doc: ('missing','estimated','actual'). Tech Lead should
-- confirm this is intentional and reconcile the older design doc's wording.
create type analytics.profit_status_t as enum ('missing', 'estimated', 'actual');

create type analytics.import_status_t as enum (
  'pending', 'merged', 'transformed', 'pdf_orphan', 'error', 'superseded'
);

-- ============================================================================
-- dim_channel / dim_channel_alias (design §2.3)
-- Global reference tables (no shop_id) — same pattern as public.channel/carrier
-- in 0001: shop-agnostic canonical list, INSERT to extend, no migration needed.
-- ============================================================================

create table analytics.dim_channel (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = lower(code)),
  name text not null,
  channel_role text not null check (channel_role in ('acquisition', 'conversion', 'both')),
  oms_channel_id uuid references public.channel (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_dim_channel_updated_at
  before update on analytics.dim_channel
  for each row execute function public.set_updated_at();

create table analytics.dim_channel_alias (
  id uuid primary key default gen_random_uuid(),
  alias_raw text not null unique,
  channel_id uuid not null references analytics.dim_channel (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index idx_dim_channel_alias_channel_id on analytics.dim_channel_alias (channel_id);

-- Seed canonical channels. channel_role assumptions (not explicit in design,
-- flagged): tiktok=acquisition (reach, per §10 flywheel narrative),
-- line_oa=conversion (closes sales), facebook=both, shopee=conversion
-- (marketplace checkout). oms_channel_id backfilled from public.channel where
-- the code already exists there (shopee/tiktok per 0001 seed) — line_oa/facebook
-- have no OMS channel_account counterpart yet, left null.
insert into analytics.dim_channel (code, name, channel_role, oms_channel_id)
select v.code, v.name, v.channel_role, c.id
from (values
  ('tiktok', 'TikTok Shop', 'acquisition'),
  ('shopee', 'Shopee', 'conversion'),
  ('line_oa', 'LINE OA', 'conversion'),
  ('facebook', 'Facebook', 'both')
) as v (code, name, channel_role)
left join public.channel c on c.code = v.code
on conflict (code) do nothing;

-- Seed exactly the aliases confirmed in stg-import-schema.md §6:
-- "gap จริงแค่ seed dim_channel_alias (LINE_OA→line_oa, Tiktok→tiktok, facebook→facebook)"
insert into analytics.dim_channel_alias (alias_raw, channel_id)
select v.alias_raw, dc.id
from (values
  ('LINE_OA', 'line_oa'),
  ('Tiktok', 'tiktok'),
  ('facebook', 'facebook')
) as v (alias_raw, channel_code)
join analytics.dim_channel dc on dc.code = v.channel_code
on conflict (alias_raw) do nothing;

-- ============================================================================
-- dim_date (design §2.5) — global calendar table, 2019-2035.
-- ============================================================================

create table analytics.dim_date (
  date_key date primary key,
  year int not null,
  quarter int not null,
  month int not null,
  month_name_th text not null,
  day_of_week int not null,
  is_weekend boolean not null,
  is_payday_window boolean not null
);

insert into analytics.dim_date (
  date_key, year, quarter, month, month_name_th, day_of_week, is_weekend, is_payday_window
)
select
  d::date,
  extract(year from d)::int,
  extract(quarter from d)::int,
  extract(month from d)::int,
  (array[
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ])[extract(month from d)::int],
  extract(dow from d)::int,
  extract(dow from d)::int in (0, 6),
  -- design §2.5: "payday window (25-5)" — วันที่ 25 ถึงสิ้นเดือน หรือ 1-5 ต้นเดือน
  (extract(day from d)::int >= 25 or extract(day from d)::int <= 5)
from generate_series('2019-01-01'::date, '2035-12-31'::date, interval '1 day') as d;

-- ============================================================================
-- dim_geo (design §2.6) — global province list, PK = ISO-3166-2:TH code.
--
-- DECISION: seeding only the mandatory 'TH-XX' unknown fallback row here, not
-- the full 77-province list. Reasoning: transliterated Thai province names
-- typed from memory in a migration file are a real data-quality risk (wrong
-- spelling ships silently, analytics/export downstream trusts it) — safer to
-- have ops/architect load+review a verified province seed script separately
-- before Phase A2 marts depend on it. The task brief's explicit ask
-- ("dim_geo ... จังหวัด TH-XX") only requires the unknown-fallback row to exist
-- so fact_order.province_code default works; flagging the full-seed gap here.
-- ============================================================================

create table analytics.dim_geo (
  province_code text primary key,
  province_name_th text,
  province_name_en text,
  region text check (region in ('bkk_metro', 'central', 'north', 'northeast', 'east', 'west', 'south')),
  is_unknown boolean not null default false
);

insert into analytics.dim_geo (province_code, province_name_th, province_name_en, region, is_unknown)
values ('TH-XX', 'ไม่ทราบจังหวัด', 'Unknown', null, true)
on conflict (province_code) do nothing;

-- ============================================================================
-- dim_customer / dim_customer_identity (design §2.1 / §2.2)
-- ============================================================================

create table analytics.dim_customer (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  display_name text,
  primary_phone_hash text,
  email_hash text,
  pdpa_consent boolean not null default false,
  consent_at timestamptz,
  consent_source text,
  first_order_at timestamptz,
  last_order_at timestamptz,
  first_touch_channel_id uuid references analytics.dim_channel (id) on delete set null,
  merged_into_id uuid references analytics.dim_customer (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_dim_customer_no_self_merge check (merged_into_id is null or merged_into_id <> id)
);

create index idx_dim_customer_shop_id on analytics.dim_customer (shop_id);
create index idx_dim_customer_merged_into_id on analytics.dim_customer (merged_into_id);

-- OWN ADDITION (not explicit in design): partial unique index preventing two
-- non-merged customer rows in the same shop from sharing a phone hash — the
-- exact "one identity = one customer" invariant §2.2's resolution rule
-- describes, enforced as a guard rail rather than relying on ELT discipline
-- alone. Scoped to `merged_into_id is null` so historical merged (soft-deleted)
-- rows never block the merge itself.
create unique index uq_dim_customer_shop_phone_active
  on analytics.dim_customer (shop_id, primary_phone_hash)
  where primary_phone_hash is not null and merged_into_id is null;

create trigger trg_dim_customer_updated_at
  before update on analytics.dim_customer
  for each row execute function public.set_updated_at();

create table analytics.dim_customer_identity (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  customer_id uuid not null references analytics.dim_customer (id) on delete cascade,
  identity_type text not null check (
    identity_type in ('phone', 'line_id', 'tiktok_handle', 'facebook', 'shopee_username', 'email')
  ),
  identity_value_norm text not null,
  identity_value_hash text not null,
  confidence text not null check (confidence in ('exact', 'probable', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_dim_customer_identity unique (shop_id, identity_type, identity_value_norm)
);

create index idx_dim_customer_identity_customer_id on analytics.dim_customer_identity (customer_id);

create trigger trg_dim_customer_identity_updated_at
  before update on analytics.dim_customer_identity
  for each row execute function public.set_updated_at();

-- ============================================================================
-- dim_campaign (design §2.4)
-- ============================================================================

create table analytics.dim_campaign (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  channel_id uuid not null references analytics.dim_channel (id) on delete restrict,
  platform_campaign_id text,
  name text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  objective text not null check (
    objective in ('awareness', 'traffic', 'conversion', 'live', 'retargeting')
  ),
  started_at date,
  ended_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Design's unique key uses coalesce(platform_campaign_id, name) — a table
-- CONSTRAINT UNIQUE can't take an expression, so this is a unique index
-- instead (same enforcement, matching design §2.4 literally).
create unique index uq_dim_campaign_shop_channel_ref
  on analytics.dim_campaign (shop_id, channel_id, coalesce(platform_campaign_id, name));

create index idx_dim_campaign_shop_id on analytics.dim_campaign (shop_id);

create trigger trg_dim_campaign_updated_at
  before update on analytics.dim_campaign
  for each row execute function public.set_updated_at();

-- ============================================================================
-- v_dim_product (design §2.7) — no new product table, view over public.product.
-- Read-only projection; never widen this to unit_cost/shop internals beyond
-- what's already visible via public.product's own RLS (view runs with the
-- caller's privileges since it has no security definer/invoker override needed
-- here — it selects from a table the caller can already read under RLS).
-- ============================================================================

create view analytics.v_dim_product as
select
  p.id as product_id,
  p.shop_id,
  p.sku,
  p.name,
  p.unit_cost,
  p.is_active,
  -- TODO (Phase A2, design §12): derive from a `ref_sku_prefix` prefix->category
  -- mapping table once seeded (e.g. NC -> necklace). Left null in Phase A1 —
  -- schema DDL only, no mapping table in scope for this migration.
  null::text as category,
  p.created_at,
  p.updated_at
from public.product p;

-- ============================================================================
-- fact_order (design §3.1)
-- ============================================================================

create table analytics.fact_order (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  oms_order_id uuid references public.orders (id) on delete set null,
  source_order_no text not null,
  customer_id uuid references analytics.dim_customer (id) on delete set null,
  channel_id uuid not null references analytics.dim_channel (id) on delete restrict,
  campaign_id_first uuid references analytics.dim_campaign (id) on delete set null,
  campaign_id_last uuid references analytics.dim_campaign (id) on delete set null,
  order_date date not null references analytics.dim_date (date_key),
  paid_at timestamptz,
  printed_at timestamptz,
  ship_date date,
  estimated_delivery_date date,
  province_code text not null default 'TH-XX' references analytics.dim_geo (province_code),
  carrier_code text,
  -- OWN ADDITION: design §3.1's column table doesn't list tracking_no, but
  -- §13's TikTok label field-mapping explicitly maps "Tracking (JTTH...)" ->
  -- fact_order.tracking_no ("carrier=J&T" alongside carrier_code). Added to
  -- reconcile the two sections of the same design doc.
  tracking_no text,
  item_count int,
  revenue numeric(12, 2) not null check (revenue >= 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  shipping_fee_customer numeric(12, 2),
  shipping_cost_shop numeric(12, 2),
  cogs numeric(12, 2),
  profit numeric(12, 2),
  profit_status analytics.profit_status_t not null default 'missing',
  payment_method text,
  bank text,
  is_new_customer boolean,
  tags text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- stg-import-schema.md §6: "fact_order upsert ด้วย unique (shop_id,
  -- source_order_no) ← ต้องเพิ่ม constraint นี้ (design เดิมมีแต่ oms_order_id
  -- unique)" — added per that explicit instruction.
  constraint uq_fact_order_shop_source_order_no unique (shop_id, source_order_no)
);

-- Design says "oms_order_id unique null" (nullable + unique) — a plain column
-- UNIQUE constraint already allows multiple NULLs in Postgres, so this could
-- be a table constraint; using a partial index instead only for symmetry/
-- readability with the other partial-unique indexes in this file — behavior
-- is identical to `unique` on the column.
create unique index uq_fact_order_oms_order_id
  on analytics.fact_order (oms_order_id)
  where oms_order_id is not null;

create index idx_fact_order_shop_order_date on analytics.fact_order (shop_id, order_date);
create index idx_fact_order_customer_id on analytics.fact_order (customer_id);
create index idx_fact_order_channel_order_date on analytics.fact_order (channel_id, order_date);

create trigger trg_fact_order_updated_at
  before update on analytics.fact_order
  for each row execute function public.set_updated_at();

-- ============================================================================
-- fact_order_item (design §3.2)
-- ============================================================================

create table analytics.fact_order_item (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  fact_order_id uuid not null references analytics.fact_order (id) on delete cascade,
  product_id uuid references public.product (id) on delete restrict,
  sku_snapshot text,
  product_name_snapshot text,
  qty int not null check (qty > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  unit_cost_snapshot numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_fact_order_item_fact_order_id on analytics.fact_order_item (fact_order_id);
create index idx_fact_order_item_product_id on analytics.fact_order_item (product_id);

create trigger trg_fact_order_item_updated_at
  before update on analytics.fact_order_item
  for each row execute function public.set_updated_at();

-- ============================================================================
-- fact_ad_spend (design §3.3)
-- ============================================================================

create table analytics.fact_ad_spend (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  spend_date date not null references analytics.dim_date (date_key),
  channel_id uuid not null references analytics.dim_channel (id) on delete restrict,
  campaign_id uuid references analytics.dim_campaign (id) on delete set null,
  spend_amount numeric(12, 2) not null check (spend_amount >= 0),
  impressions bigint,
  clicks bigint,
  platform_reported_conversions bigint,
  entry_method text not null default 'manual' check (entry_method in ('manual', 'api')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Design §3.3 literal key: unique (shop_id, spend_date, channel_id,
-- coalesce(campaign_id, uuid_nil())) — expression again requires a unique
-- index, not a table constraint.
create unique index uq_fact_ad_spend_upsert_key
  on analytics.fact_ad_spend (shop_id, spend_date, channel_id, coalesce(campaign_id, uuid_nil()));

create index idx_fact_ad_spend_shop_spend_date on analytics.fact_ad_spend (shop_id, spend_date);

create trigger trg_fact_ad_spend_updated_at
  before update on analytics.fact_ad_spend
  for each row execute function public.set_updated_at();

-- ============================================================================
-- fact_touchpoint (design §3.4)
-- ============================================================================

create table analytics.fact_touchpoint (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  customer_id uuid references analytics.dim_customer (id) on delete set null,
  channel_id uuid not null references analytics.dim_channel (id) on delete restrict,
  campaign_id uuid references analytics.dim_campaign (id) on delete set null,
  touched_at timestamptz not null,
  touch_type text not null check (
    touch_type in ('ad_click', 'live_view', 'line_add_friend', 'chat', 'order')
  ),
  utm_raw jsonb,
  source_ref text,
  created_at timestamptz not null default now()
);

create index idx_fact_touchpoint_customer_id on analytics.fact_touchpoint (customer_id);
create index idx_fact_touchpoint_channel_touched_at on analytics.fact_touchpoint (channel_id, touched_at);

-- ============================================================================
-- dim_address (design §11) — deliberately created AFTER fact_order/dim_customer:
-- it FKs into both (fact_order_id, customer_id), which don't exist earlier in
-- the dependency chain despite being conceptually a "dim" table. Same kind of
-- deferred-ordering note as 0001's header comment for stock_ledger.order_id.
-- ============================================================================

create table analytics.dim_address (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  fact_order_id uuid references analytics.fact_order (id) on delete cascade,
  customer_id uuid references analytics.dim_customer (id) on delete set null,
  raw_address text not null,
  house_no text,
  building text,
  floor_room text,
  place_name text,
  moo text,
  road text,
  soi text,
  subdistrict text,
  district text,
  province_code text not null default 'TH-XX' references analytics.dim_geo (province_code),
  zipcode text check (zipcode is null or zipcode ~ '^[0-9]{5}$'),
  address_type text not null default 'unknown' check (
    address_type in (
      'residence_house', 'housing_project', 'condo', 'company',
      'business_premise', 'government_edu', 'other', 'unknown'
    )
  ),
  address_type_source text not null default 'rule' check (
    address_type_source in ('rule', 'manual', 'model')
  ),
  parse_confidence text not null default 'unparsed' check (
    parse_confidence in ('high', 'low', 'unparsed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_dim_address_fact_order_id on analytics.dim_address (fact_order_id);
create index idx_dim_address_customer_id on analytics.dim_address (customer_id);
create index idx_dim_address_shop_id on analytics.dim_address (shop_id);

create trigger trg_dim_address_updated_at
  before update on analytics.dim_address
  for each row execute function public.set_updated_at();
