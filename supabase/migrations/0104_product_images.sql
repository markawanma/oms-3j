-- 0104_product_images.sql
-- SKU product-image upload — data layer only (design approved by Tech Lead;
-- frontend-dev wires up the UI in the next round). Owner-confirmed limits:
-- <=5 images shown per SKU in the UI, MAX_IMAGES_PER_SKU=8 is the hard
-- server-side ceiling (headroom above the UI's display count — see
-- lib/catalog/image-constants.ts for the same constant + the handoff report
-- for why these two numbers are allowed to differ).
--
-- ⚠️ PREPARED, NOT APPLIED — this file is written to be reviewed and applied
-- by the owner (supabase-migrate skill: pre-check -> apply_migration ->
-- self-verify -> get_advisors). Do not run this against a live project as
-- part of writing it.
--
-- ============================================================================
-- Why NOT public.product.image_url / 0009_public_catalog.sql
-- ============================================================================
-- 0009 is flagged "DO NOT APPLY YET" and adds a single `image_url text`
-- column to `product` for the (unbuilt) /shop public catalog. That shape is
-- wrong for this feature on two counts even once 0009 does get applied:
--   1. One column can't hold up to 8 images per SKU.
--   2. This feature needs TWO sizes per image (md for print/email, sm for
--      thumbnails) plus ordering (sort_order) and provenance (width/height/
--      bytes) — a single URL string carries none of that.
-- product_image is a new, independent table; it does not touch product.
-- image_url at all, so it stays compatible with 0009 landing later (or never
-- landing) without any migration conflict.
--
-- ============================================================================
-- What this file creates
-- ============================================================================
-- 1) storage bucket 'product-images' — PUBLIC (unlike shipping-labels/
--    label_file in 0097/0098, which are private): outbound documents (OEM
--    quote emails, line sheets) need to embed a plain <img src> URL that
--    loads without a signed-URL round trip, so the bucket is public from the
--    start (file_size_limit + allowed_mime_types set in the SAME insert this
--    time — 0097 forgot these and needed a follow-up migration, 0098, to
--    patch the gap; not repeating that here).
-- 2) public.product_image — 1 row per uploaded image, up to
--    MAX_IMAGES_PER_SKU (8) rows per product. No `is_primary` column: the
--    primary image is simply the first row ordered by (sort_order,
--    created_at, id) — one less piece of state that could go out of sync
--    with reality (design decision, see design doc header).
-- 3) A BEFORE INSERT trigger enforcing the 8-image cap AT THE DATABASE LEVEL,
--    serialized with a transaction-scoped advisory lock per product_id.
--    OWN ADDITION (not explicitly requested by design, added for defense in
--    depth): the design brief for lib/actions/catalog-images.ts already asks
--    the server action to count-then-reject before inserting, but this app
--    has no real auth (`middleware.ts` gate is off) and requireOwnerAdmin()
--    is just a role env var — the ONLY things standing between "any request
--    that reaches this server" and "SKU has 40 images" are the checks that
--    run inside a single request. An app-layer count check alone has a
--    TOCTOU race: two uploads for the same SKU landing in the same window
--    could both read count=7 and both insert, ending at 9. The trigger below
--    closes that race structurally (advisory lock serializes concurrent
--    inserts for the same product_id; the count check then sees a
--    consistent view) instead of relying on request timing never being
--    unlucky. Rollback for this piece alone, if ever needed: `drop trigger
--    trg_product_image_cap on public.product_image; drop function
--    public.product_image_enforce_cap();` — the table/bucket are unaffected.
--
-- ============================================================================
-- Storage policy — deliberately NONE
-- ============================================================================
-- No storage.objects policy is added for INSERT/UPDATE/DELETE on this
-- bucket, for anon OR authenticated. Every write in this app goes through
-- lib/actions/catalog-images.ts using the SERVICE ROLE client
-- (lib/supabase/server.ts getServiceClient()), which bypasses storage RLS
-- entirely — the same reasoning behind shipping-labels having zero storage
-- policies (0097 header comment). `public = true` below only affects READS
-- (the `/storage/v1/object/public/...` endpoint bypasses RLS for GET on a
-- public bucket) — it grants no write access to anyone.
--
-- ============================================================================
-- RLS on public.product_image — enable, ZERO policies (service-role only)
-- ============================================================================
-- Same pattern as analytics.label_file (0097) and public.sync_job (0002):
-- RLS enabled with no policy for anon/authenticated means default-deny for
-- both roles regardless of what table-level GRANTs Supabase's platform
-- default-privilege bootstrap applies to new `public` schema tables (Supabase
-- auto-grants SELECT on new public tables to anon/authenticated at the
-- platform level, same as it does for `product` itself — see 0002_rls.sql's
-- own `product` policy, which relies on RLS, not on the absence of a grant,
-- to enforce tenant isolation). service_role has BYPASSRLS and is
-- unaffected either way. No REVOKE statements are added here, matching the
-- precedent already set by every other service-role-only table in this repo
-- (0002 sync_job, 0097 label_file/stg_label_page) — RLS is the actual gate,
-- not the grant/revoke state.
--
-- ============================================================================
-- Grants — none added (skill 3j-migration-traps #7: no schema-wide grant,
-- and this file needs no per-object grant either — see RLS note above for
-- why service_role already has full access without one).
-- ============================================================================
--
-- Idempotent — `insert ... on conflict do nothing` / `create table if not
-- exists` / `create index if not exists` / `create or replace function`
-- throughout, safe to re-run.
--
-- Touches: public.product_image (new) · storage.buckets (new row,
-- 'product-images') · public.product (read-only FK reference, no ALTER).

-- ============================================================================
-- 1. Storage bucket
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

-- ============================================================================
-- 2. public.product_image
-- ============================================================================

create table if not exists public.product_image (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  product_id uuid not null references public.product (id) on delete cascade,
  -- 'md' variant path (long edge <= MD_MAX_PX, lib/catalog/image-constants.ts)
  -- — this is the "the" image for a row; print/email use this size.
  storage_path text not null,
  -- 'sm' variant path (long edge <= SM_MAX_PX) — thumbnails/list views.
  -- Always present: lib/actions/catalog-images.ts uploads both variants in
  -- one call, there is no code path that creates a row with only one size.
  variant_sm_path text not null,
  -- Manual override for display order — see header comment for why there's
  -- no separate is_primary column (primary = row 0 by this same ordering).
  sort_order int not null default 0 check (sort_order >= 0),
  -- Server-derived from the uploaded md file's actual JPEG bytes (SOF marker
  -- parse — see lib/catalog/image-server.ts), NOT trusted from the client.
  -- Nullable: purely informational metadata (aspect-ratio hints for the
  -- gallery UI), never used in a security/business decision, so a failed
  -- parse degrades to "unknown" instead of blocking the upload.
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  -- byte size of the md file as actually received server-side (never the
  -- client-declared size) — mirrors analytics.label_file.file_size_bytes'
  -- `> 0` check; no upper-bound check duplicated here on purpose (the
  -- storage bucket's file_size_limit above is the authoritative ceiling —
  -- same precedent as label_file, which doesn't duplicate MAX_LABEL_FILE_BYTES
  -- as a table CHECK either).
  bytes int check (bytes is null or bytes > 0),
  created_at timestamptz not null default now(),
  constraint uq_product_image_storage_path unique (storage_path),
  constraint uq_product_image_variant_sm_path unique (variant_sm_path)
);

-- Tenant-scoped listing/counting (lib/actions/catalog-images.ts counts
-- existing rows per product on every upload).
create index if not exists idx_product_image_shop_id on public.product_image (shop_id);

-- Covers both "primary image per product" (getProducts in catalog.ts) and
-- "full gallery for one product, in display order" (getProductImages) in a
-- single index — trailing `id` makes the sort fully deterministic, same
-- requirement fetchAllRows() imposes on every ORDER BY it pages through
-- (lib/supabase/query-limits.ts header comment, "second bug").
create index if not exists idx_product_image_product_sort
  on public.product_image (product_id, sort_order, created_at, id);

alter table public.product_image enable row level security;
-- No policy — see "RLS on public.product_image" note above. Service-role only.

-- ============================================================================
-- 3. 8-image-per-SKU cap — enforced structurally, not just in app code
-- ============================================================================
-- See header comment ("OWN ADDITION") for why this exists on top of the
-- app-layer count check the design brief already asks for.

create or replace function public.product_image_enforce_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  -- Transaction-scoped advisory lock keyed on product_id — serializes
  -- concurrent inserts for the SAME product so the count below can't be
  -- read stale by a sibling transaction that hasn't committed yet. Released
  -- automatically at commit/rollback (hashtextextended gives a well-
  -- distributed bigint key from the uuid's text form).
  perform pg_advisory_xact_lock(hashtextextended(new.product_id::text, 0));

  select count(*) into v_count
    from public.product_image
   where product_id = new.product_id;

  if v_count >= 8 then
    raise exception 'product_image: product % already has % images (max 8)', new.product_id, v_count
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_product_image_cap on public.product_image;
create trigger trg_product_image_cap
  before insert on public.product_image
  for each row
  execute function public.product_image_enforce_cap();

notify pgrst, 'reload schema';
