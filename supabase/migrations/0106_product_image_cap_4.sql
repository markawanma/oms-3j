-- 0106_product_image_cap_4.sql
-- Per-SKU image ceiling 8 -> 4 (owner's decision, 2026-09-02: "ลดเป็น 4 รูป
-- ต่อชิ้น"). Shop-level byte budget from 0105 is unchanged.
--
-- 🔴 This literal is the DATABASE half of a number that also lives in
-- lib/catalog/image-constants.ts (MAX_IMAGES_PER_SKU). They must move
-- together in the same change — if the app allows more than the trigger does,
-- the upload form offers a slot the database then rejects and the user gets
-- an error they cannot act on. If you are reading this because you are
-- changing the cap again: grep MAX_IMAGES_PER_SKU first.
--
-- Existing rows are NOT touched. No SKU can have more than 4 images today
-- (the table has 0 rows at the time of writing), but if that ever changes,
-- lowering the cap only blocks NEW inserts — it never deletes anything, which
-- is the correct behaviour for a ceiling change: destroying a shop's uploaded
-- pictures because a config number moved would be a far worse surprise than
-- an over-quota SKU that simply cannot take a fifth image.
--
-- Everything else in this function is carried over verbatim from 0105:
-- same advisory-lock order (product first, then shop), same byte budget,
-- same errcodes (P0001 per-SKU, P0003 shop budget). Only the integer moved.
--
-- No grant/revoke touch-up needed: `returns trigger` functions are not
-- reachable via EXECUTE (Postgres refuses to call them outside a trigger,
-- PostgREST never exposes them as RPC) — the same reasoning 0104 and 0105
-- both documented for this exact function.

create or replace function public.product_image_enforce_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_product_count int;
  v_shop_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.product_id::text, 0));

  select count(*) into v_product_count
    from public.product_image
   where product_id = new.product_id;

  -- keep in sync with MAX_IMAGES_PER_SKU (lib/catalog/image-constants.ts)
  if v_product_count >= 4 then
    raise exception 'product_image: product % already has % images (max 4)', new.product_id, v_product_count
      using errcode = 'P0001';
  end if;

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

notify pgrst, 'reload schema';
