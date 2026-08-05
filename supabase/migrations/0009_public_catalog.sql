-- 0009_public_catalog.sql
-- Public catalog for /shop (Architect design: docs/3j-jewelry/web/shop-route-design.md §2).
--
-- ⚠️ DO NOT APPLY YET — see FLAG below. This migration hardcodes a shop_id
-- placeholder that MUST be replaced with the real 3J Jewelry shop.id before
-- this file is ever run against Supabase (SQL editor / `supabase db push`).
--
-- Why hardcoded and not looked up dynamically here: there is no seed row in
-- this repo for "3J Jewelry" — docs/3j-jewelry/oms/dev-seed.sql only inserts
-- a dummy dev shop ('ร้านตัวอย่าง (dev)', t-shirts/mugs) for frontend
-- preview, and DEV_SHOP_ID is an env var (not readable from a plain SQL
-- migration). Pinning a literal uuid in the view (per design §2b) is the
-- correct approach once the real id is known — do not switch to a `name =`
-- subquery lookup, that reintroduces an ambiguous-match / wrong-tenant risk
-- if a second shop with a similar name is ever created.
--
-- FLAG (must resolve before apply): replace every occurrence of
-- '00000000-0000-0000-0000-000000000000'::uuid below with the real 3J
-- Jewelry shop.id (SELECT id FROM shop WHERE name = '<real 3J shop name>';
-- on the actual Supabase project — verify with the team, do not guess).
-- The placeholder is the nil uuid on purpose: it can never match a real
-- gen_random_uuid() row, so if this migration is applied unedited the view
-- returns zero rows (fails safe/closed) instead of silently pinning the
-- wrong tenant.

-- (a) Catalog columns on product — nullable / safe defaults, existing rows
-- unaffected. `is_public` defaults to false: opt-in per item, closes the
-- "new product accidentally shows up on the public site" hole.
alter table product
  add column selling_price numeric(12, 2) check (selling_price is null or selling_price >= 0),
  add column image_url text,
  add column is_public boolean not null default false;

-- (b) Safe view — allowlist columns only. NEVER add a column here without a
-- security review (see design §6 checklist): no unit_cost, barcode,
-- shop_id, stock, margin, product_mapping, channel_account.
-- security_invoker defaults to false -> view runs as owner (postgres),
-- bypassing product's RLS; the WHERE clause below is what actually enforces
-- the public-facing filter, not RLS.
--
-- MINIMAL SCOPE ADJUSTMENT (per owner instruction, deviates from design
-- §2b): design's WHERE required `selling_price > 0` (price hidden until
-- priced). Minimal scope allows `selling_price is null` through too, so an
-- unpriced-but-public item still shows in the grid with a "สอบถามราคา"
-- (ask for price) state client-side instead of being hidden entirely. The
-- gate that actually controls visibility is `is_public` (opt-in, defaults
-- false) — a null price alone does not leak anything sensitive.
create view public.shop_catalog as
select
  p.id,
  p.sku,
  p.name,
  p.selling_price,
  p.image_url
from product p
where p.is_active
  and p.is_public
  and (p.selling_price is null or p.selling_price > 0)
  and p.shop_id = '00000000-0000-0000-0000-000000000000'::uuid; -- FLAG: replace with real 3J shop_id before apply

-- (c) Grants — anon/authenticated can read this view only. Base table
-- `product` gets no additional grants (RLS default-deny from 0002 already
-- blocks anon there; this migration must not weaken that).
revoke all on public.shop_catalog from public, anon, authenticated;
grant select on public.shop_catalog to anon, authenticated;
