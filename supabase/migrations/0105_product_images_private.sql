-- 0105_product_images_private.sql
-- Closes C1 (Critical) and H2 (High) from the 2026-09-02 security audit of
-- the SKU product-image upload feature (0104_product_images.sql). Owner
-- confirmed before writing this: public.product_image has 0 rows and
-- storage.objects has 0 policies on the live project right now, so this
-- migration changes nothing anyone is depending on today.
--
-- ⚠️ NOT YET APPLIED — written for the owner to review and apply via the
-- supabase-migrate skill (pre-check -> apply_migration -> self-verify ->
-- get_advisors). Do not run this against the live project while writing it.
--
-- ============================================================================
-- C1 — bucket was PUBLIC + only a 3-byte magic-number check gated uploads
-- ============================================================================
-- lib/catalog/image-server.ts's looksLikeJpeg() only checks the first 3
-- bytes (FF D8 FF), and lib/actions/catalog-images.ts's uploadProductImage()
-- writes the CLIENT'S RAW BYTES to storage with no re-encode. A request that
-- prepends those 3 bytes to an arbitrary payload (exe/zip/anything, up to
-- the bucket's 1MB file_size_limit) passes every check today, and the
-- action hands the caller back a path that resolves to a real, permanent,
-- PUBLIC URL on this project's own Supabase domain the moment it lands —
-- i.e. this app could currently be used as an anonymous file host on 3J's
-- domain. The realistic damage isn't data leakage (there's no secret in an
-- image bucket) — it's Supabase flagging the project for abuse and
-- suspending it, which takes the WHOLE app (every business function, not
-- just images) down at once. The owner accepted "prod is publicly
-- reachable" as a risk on 2026-09-01 (memory: "Prod exposure: accepted
-- risk") but did NOT accept "and can host arbitrary public files" — this
-- bucket didn't exist yet at that decision.
--
-- Two ways to close this: (a) re-encode every upload through a real image
-- library (sharp) server-side before it ever reaches storage, so only
-- genuine re-encoded pixels can land there, letting the bucket stay public;
-- or (b) flip the bucket private and serve reads through short-lived signed
-- URLs, which makes "upload arbitrary bytes" harmless because nobody can
-- fetch them back without going through this app's own server action.
--
-- (b) is what this migration does. Nothing in this app needs a public,
-- long-lived image URL yet — grep confirmed publicImageUrl() (now removed,
-- lib/catalog/image-constants.ts) had exactly 2 callers, both admin screens
-- that can just as well call a server action for a signed URL. Re-encoding
-- is the RIGHT fix once outbound OEM quote/email documents need to embed a
-- plain <img src> that must keep working for years without a refresh
-- (signed URLs can't do that) — but pulling in `sharp` (a native binary +
-- its own CVE surface) for a feature that doesn't exist yet is exactly the
-- kind of dependency creep this project avoids. When that feature is built:
-- add server-side re-encoding FIRST, then flip this bucket back to public —
-- never the other way around.
update storage.buckets
   set public = false
 where id = 'product-images';

-- ============================================================================
-- H2 — no shop-level ceiling above the existing per-SKU cap
-- ============================================================================
-- 0104 already caps each SKU at 8 images via an advisory-lock-guarded
-- trigger, but nothing caps how many SKUs a shop can have (upsertProduct has
-- no such limit), so "8 images x unlimited SKUs" isn't actually bounded.
-- 303 SKUs x 8 images x 2 variants x up to 1MB each computes to ~4.85GB
-- against Supabase's free-tier 1GB storage quota.
--
-- Adds a shop-level count check to the SAME trigger function, using the SAME
-- advisory-lock pattern as the per-product check right above it — closes
-- the identical TOCTOU race at the shop level (two concurrent uploads for
-- two DIFFERENT SKUs in the same shop both reading a stale shop-wide total
-- and both inserting). The shop-level lock uses a different advisory-lock
-- seed (1, vs. 0 for the per-product lock) so the two keys can never
-- collide, and it is always acquired AFTER the per-product lock in every
-- code path through this function — a consistent acquisition order across
-- every call is what makes this safe from self-deadlock.
--
-- 1200 rows/shop: with MAX_IMAGES_PER_SKU=8 that's headroom for 150 SKUs'
-- worth of completely full galleries — comfortably above this shop's real
-- SKU count today (303, mostly with zero images right now). At the ceiling
-- (1200 rows x 2 variants x up to 1MB) worst case is ~2.4GB, which still
-- needs a paid Supabase tier but is a deliberate, tunable ceiling instead of
-- "unlimited". If the real number ever needs to move, change the constant
-- below, not the locking mechanism.
--
-- Function signature is UNCHANGED (still `returns trigger`, no arguments) —
-- `create or replace` replaces the SAME function object in place (skill
-- 3j-migration-traps #1 only bites when the arg list changes), so the
-- existing trg_product_image_cap trigger keeps pointing at it with nothing
-- else to re-create.
--
-- No grant/revoke touch-up (skill 3j-migration-traps #2 normally requires
-- this on every `create or replace function` — deliberately not applicable
-- here, not skipped by oversight): this function `returns trigger`, and
-- Postgres refuses to execute a trigger-returning function outside of an
-- actual trigger context ("trigger functions can only be called as
-- triggers") — PostgREST also never exposes `returns trigger` functions as
-- RPC targets. It was not reachable via any EXECUTE grant before this change
-- and still isn't after it (0104's own header comment makes the identical
-- argument for why no grants were added there in the first place). Even if
-- it somehow were reachable, public.product_image has RLS enabled with ZERO
-- policies for anon/authenticated (0104) and this function is NOT `security
-- definer`, so it always runs as the calling role — only service_role can
-- ever get past RLS to trigger an INSERT on this table to begin with.
create or replace function public.product_image_enforce_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_product_count int;
  v_shop_count int;
begin
  -- Per-product lock + cap — unchanged from 0104.
  perform pg_advisory_xact_lock(hashtextextended(new.product_id::text, 0));

  select count(*) into v_product_count
    from public.product_image
   where product_id = new.product_id;

  if v_product_count >= 8 then
    raise exception 'product_image: product % already has % images (max 8)', new.product_id, v_product_count
      using errcode = 'P0001';
  end if;

  -- Shop-level lock + cap (H2, new in 0105).
  perform pg_advisory_xact_lock(hashtextextended(new.shop_id::text, 1));

  select count(*) into v_shop_count
    from public.product_image
   where shop_id = new.shop_id;

  if v_shop_count >= 1200 then
    raise exception 'product_image: shop % already has % images across all SKUs (max 1200)', new.shop_id, v_shop_count
      using errcode = 'P0003';
  end if;

  return new;
end;
$$;

-- Idempotent (update ... where / create or replace function), safe to re-run.

notify pgrst, 'reload schema';
