-- 0011_analytics_staging.sql
-- Staging tables + PII table per docs/3j-jewelry/analytics/stg-import-schema.md
-- (locked spec, 2026-08-10) — depends on 0010 (analytics.fact_order,
-- analytics.fact_order_item, analytics.dim_customer all exist by here).
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

-- ============================================================================
-- stg_import_batch (spec §1) — grain: 1 row = 1 imported file.
-- ============================================================================

create table analytics.stg_import_batch (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  source_type text not null check (
    source_type in ('excel_order_report', 'tiktok_label_pdf', 'tiktok_slip_pdf')
  ),
  file_name text,
  file_hash text not null,
  period_hint text,
  row_count_parsed int,
  row_count_loaded int,
  status text not null default 'loaded' check (
    status in ('loaded', 'merged', 'transformed', 'failed')
  ),
  imported_by uuid references auth.users (id) on delete set null,
  imported_at timestamptz not null default now(),
  -- OWN ADDITION: spec §1 doesn't list created_at/updated_at, but `status`
  -- transitions over the batch's lifecycle (loaded -> merged -> transformed /
  -- failed) — added for the same audit reason every other lifecycle-status
  -- table in this repo (orders, sync_job) tracks updated_at.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_stg_import_batch_shop_file_hash unique (shop_id, file_hash)
);

create index idx_stg_import_batch_shop_id on analytics.stg_import_batch (shop_id);

create trigger trg_stg_import_batch_updated_at
  before update on analytics.stg_import_batch
  for each row execute function public.set_updated_at();

-- ============================================================================
-- stg_order_import (spec §2) — grain: 1 row = 1 order per source
-- (Excel row, or TikTok PDF label). Every typed column is nullable by design
-- (spec: "ไฟล์เก่าคอลัมน์ไม่ครบก็ลงได้") — `raw` is the only source of truth
-- that's guaranteed complete.
-- ============================================================================

create table analytics.stg_order_import (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references analytics.stg_import_batch (id) on delete cascade,
  shop_id uuid not null references public.shop (id) on delete cascade,
  source_row_no int,
  raw jsonb not null,
  source_kind text not null check (source_kind in ('excel', 'pdf_label', 'pdf_slip')),
  source_order_no text,
  marketplace_order_id text,
  channel_raw text,
  customer_name_raw text,
  contact_display_name_raw text,
  phone_raw text,
  province_raw text,
  full_address_raw text,
  zipcode_raw text,
  carrier_raw text,
  tracking_no text,
  shipping_fee_customer numeric(12, 2),
  shipping_cost_shop numeric(12, 2),
  cod_amount numeric(12, 2),
  revenue numeric(12, 2),
  discount_total numeric(12, 2),
  discount_code text,
  item_count_total int,
  -- spec §7(ค): kept for audit, deliberately NEVER copied into fact_order.profit
  -- ("เก็บแต่ไม่เชื่อ") — fact_order.profit is derived at transform time from the
  -- 10%-of-revenue estimated-margin placeholder instead.
  profit_raw numeric(12, 2),
  order_created_at timestamptz,
  paid_at timestamptz,
  printed_at timestamptz,
  created_by_raw text,
  note_raw text,
  bank_raw text,
  tags_raw text,
  sort_code text,
  sender_raw text,
  -- spec §2: dedup_key = excel `E:`+order_no, pdf `P:`+marketplace_id.
  -- Generated column (immutable, no subquery) so it always matches its
  -- source columns and can carry the `unique` constraint below.
  dedup_key text generated always as (
    case source_kind
      when 'excel' then 'E:' || coalesce(source_order_no, '')
      else 'P:' || coalesce(marketplace_order_id, '')
    end
  ) stored,
  import_status analytics.import_status_t not null default 'pending',
  error_detail text,
  fact_order_id uuid references analytics.fact_order (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint uq_stg_order_import_shop_dedup_key unique (shop_id, dedup_key)
);

create index idx_stg_order_import_batch_id on analytics.stg_order_import (batch_id);
create index idx_stg_order_import_shop_id on analytics.stg_order_import (shop_id);
create index idx_stg_order_import_marketplace_order_id
  on analytics.stg_order_import (marketplace_order_id);
create index idx_stg_order_import_fact_order_id on analytics.stg_order_import (fact_order_id);

-- ============================================================================
-- stg_order_item_import (spec §3) — grain: 1 row = 1 Packing Slip line item.
-- ============================================================================

create table analytics.stg_order_item_import (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references analytics.stg_import_batch (id) on delete cascade,
  shop_id uuid not null references public.shop (id) on delete cascade,
  marketplace_order_id text not null,
  line_no int not null,
  product_name_raw text,
  variant_raw text,
  seller_sku_raw text,
  qty int,
  raw jsonb,
  import_status text not null default 'pending' check (
    import_status in ('pending', 'transformed', 'sku_unmapped', 'error')
  ),
  fact_order_item_id uuid references analytics.fact_order_item (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint uq_stg_order_item_import_shop_order_line
    unique (shop_id, marketplace_order_id, line_no)
);

create index idx_stg_order_item_import_batch_id on analytics.stg_order_item_import (batch_id);
create index idx_stg_order_item_import_shop_id on analytics.stg_order_item_import (shop_id);
create index idx_stg_order_item_import_fact_order_item_id
  on analytics.stg_order_item_import (fact_order_item_id);

-- ============================================================================
-- pii_customer (design §7) — PII kept in exactly one place, RLS'd hardest
-- (see 0012). dim/fact/mart tables only ever carry hashes.
--
-- NOTE (PDPA retention, spec §7(จ)): the 180-day "null out PII columns on
-- stg_order_import/stg_order_item_import after transformed" job is a
-- scheduled background job (pg_cron + plain UPDATE), not schema DDL — out of
-- scope for this Phase A1 migration (task brief: "schema DDL + RLS เท่านั้น").
-- The columns it needs to null already exist above (customer_name_raw,
-- phone_raw, full_address_raw, etc.) — flagged as an explicit Phase A2 TODO,
-- do not ship staging PII retention as "done" until that job exists.
-- ============================================================================

create table analytics.pii_customer (
  customer_id uuid primary key references analytics.dim_customer (id) on delete cascade,
  shop_id uuid not null references public.shop (id) on delete cascade,
  phone_e164 text,
  full_name text,
  address jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_pii_customer_shop_id on analytics.pii_customer (shop_id);

create trigger trg_pii_customer_updated_at
  before update on analytics.pii_customer
  for each row execute function public.set_updated_at();
