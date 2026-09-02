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
-- The budget is expressed in BYTES, not row count — full rationale sits with
-- the check itself inside the function. Short version: bytes are what the
-- quota actually measures, and a row cap generous enough for this shop's real
-- catalogue (303 SKUs) is simultaneously generous enough to blow the quota.
-- If the number ever needs to move, change the constant, not the locking.
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
  v_shop_bytes bigint;
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

  -- Shop-level lock + budget (H2, new in 0105).
  --
  -- Budgeted in BYTES, not rows. Rows are the wrong unit: the thing that runs
  -- out is storage quota, and a row can hold anything from a 30KB product
  -- shot to a 1MB max-size upload — a row cap that leaves room for real use
  -- necessarily leaves room for ~30x that in bytes.
  --
  -- Why the original row cap was wrong in both directions: 1200 rows was
  -- BELOW legitimate need (303 SKUs x up to 8 images = 2,424 rows; even at
  -- the owner's stated ~5 images/SKU that's 1,515) so it would have blocked
  -- the shop partway through filling its own catalog — while still allowing
  -- 2.4GB of abuse against a 1GB free tier.
  --
  -- 600MB of md bytes: sm runs ~1/3 of md (measured: 101KB md / 36KB sm on a
  -- real 1200x900 upload), so this ceiling is ~810MB on disk — under the 1GB
  -- free tier with room for the other bucket. At realistic sizes that is
  -- ~6,000 images, far past 303 SKUs x 8; at max size it stops at 600, which
  -- is where a quota-burn attempt dies. `bytes` is the server-measured md
  -- length (never client-declared, never a parse result), so it is always
  -- present — coalesce is belt-and-braces, not a real branch.
  perform pg_advisory_xact_lock(hashtextextended(new.shop_id::text, 1));

  select coalesce(sum(bytes), 0) into v_shop_bytes
    from public.product_image
   where shop_id = new.shop_id;

  if v_shop_bytes + coalesce(new.bytes, 0) > 600 * 1024 * 1024 then
    raise exception 'product_image: shop % image storage budget reached (% bytes used, limit %)',
      new.shop_id, v_shop_bytes, 600 * 1024 * 1024
      using errcode = 'P0003';
  end if;

  return new;
end;
$$;

-- Idempotent (update ... where / create or replace function), safe to re-run.

notify pgrst, 'reload schema';
