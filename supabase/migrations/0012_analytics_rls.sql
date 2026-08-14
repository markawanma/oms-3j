-- 0012_analytics_rls.sql
-- Row Level Security for schema `analytics`, mirroring the shape of
-- 0002_rls.sql / 0004_rls_hardening.sql for `public`:
--   shop_id in (select shop_id from public.shop_member where user_id = auth.uid())
--
-- Three tiers, per design §7 + stg-import-schema.md §4(gap ฉ) + task brief:
--   1. Global reference tables (dim_channel/alias, dim_date, dim_geo) — no
--      shop_id, read-only to any authenticated user, writes = service role
--      only. Same pattern as public.channel/public.carrier in 0002.
--   2. Shop-scoped ELT-written tables (dim_customer, dim_customer_identity,
--      dim_campaign, dim_address, fact_order, fact_order_item,
--      fact_touchpoint) — SELECT-only for tenant members, same reasoning as
--      0004 H3b (orders/order_item/shipment): these are populated exclusively
--      by the nightly ELT job / staging transform running as service role,
--      there is no legitimate direct end-user write path in Phase A1.
--   3. Shop-scoped admin-entry table (fact_ad_spend) — design §6 point 2
--      explicitly describes an admin UI for manual daily spend entry, so
--      owner/admin get INSERT/UPDATE/DELETE; all tenant members can SELECT.
--   4. Restricted-PII tables (pii_customer, staging tables) — owner/admin
--      only, per design §7 ("RLS ... เฉพาะ role owner/admin") and
--      stg-import-schema.md gap (ฉ) ("staging ห้าม grant authenticated
--      ทั่วไป (PII)"). staff cannot read or write these at all.
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

-- ============================================================================
-- Tier 1 — global reference tables
-- ============================================================================

alter table analytics.dim_channel enable row level security;

create policy read_all on analytics.dim_channel
  for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

alter table analytics.dim_channel_alias enable row level security;

create policy read_all on analytics.dim_channel_alias
  for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

alter table analytics.dim_date enable row level security;

create policy read_all on analytics.dim_date
  for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

alter table analytics.dim_geo enable row level security;

create policy read_all on analytics.dim_geo
  for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- ============================================================================
-- Tier 2 — shop-scoped, ELT-written (SELECT-only for tenant members)
-- ============================================================================

alter table analytics.dim_customer enable row level security;

create policy tenant_isolation_select on analytics.dim_customer
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

alter table analytics.dim_customer_identity enable row level security;

create policy tenant_isolation_select on analytics.dim_customer_identity
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

alter table analytics.dim_campaign enable row level security;

create policy tenant_isolation_select on analytics.dim_campaign
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- NOTE: dim_campaign is SELECT-only here (ELT/service-role writes) because the
-- design docs don't specify a Phase A1 admin UI for creating campaigns (only
-- fact_ad_spend's manual-entry UI is explicit, §6 point 2). If a "create
-- campaign" UI is built later, this needs the same owner/admin insert/update
-- policy pattern as fact_ad_spend below — flagged as an open decision, not
-- assumed here.

alter table analytics.dim_address enable row level security;

create policy tenant_isolation_select on analytics.dim_address
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

alter table analytics.fact_order enable row level security;

create policy tenant_isolation_select on analytics.fact_order
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

alter table analytics.fact_order_item enable row level security;

create policy tenant_isolation_select on analytics.fact_order_item
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

alter table analytics.fact_touchpoint enable row level security;

create policy tenant_isolation_select on analytics.fact_touchpoint
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- ============================================================================
-- Tier 3 — shop-scoped, admin-entry (fact_ad_spend)
-- ============================================================================

alter table analytics.fact_ad_spend enable row level security;

create policy tenant_isolation_select on analytics.fact_ad_spend
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

create policy owner_admin_insert on analytics.fact_ad_spend
  for insert
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_update on analytics.fact_ad_spend
  for update
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_delete on analytics.fact_ad_spend
  for delete
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- ============================================================================
-- Tier 4 — restricted PII: pii_customer + staging tables. owner/admin only,
-- no delete policy anywhere in this tier (staging rows are superseded/retained
-- for audit, not deleted by end users; PII anonymization runs as a service-role
-- job — see 0011's retention note).
-- ============================================================================

alter table analytics.pii_customer enable row level security;

create policy owner_admin_select on analytics.pii_customer
  for select
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_insert on analytics.pii_customer
  for insert
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_update on analytics.pii_customer
  for update
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

alter table analytics.stg_import_batch enable row level security;

create policy owner_admin_select on analytics.stg_import_batch
  for select
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_insert on analytics.stg_import_batch
  for insert
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_update on analytics.stg_import_batch
  for update
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

alter table analytics.stg_order_import enable row level security;

create policy owner_admin_select on analytics.stg_order_import
  for select
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_insert on analytics.stg_order_import
  for insert
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_update on analytics.stg_order_import
  for update
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

alter table analytics.stg_order_item_import enable row level security;

create policy owner_admin_select on analytics.stg_order_item_import
  for select
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_insert on analytics.stg_order_item_import
  for insert
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_update on analytics.stg_order_item_import
  for update
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- ============================================================================
-- v_dim_product — plain view over public.product, RLS not applicable to views
-- (it inherits public.product's RLS since it runs with the caller's
-- privileges, no SECURITY DEFINER). No grants needed beyond what
-- authenticated already has on public.product via 0002's tenant_isolation
-- policy — flagged here only as a checklist confirmation, no DDL required.
-- ============================================================================
