// lib/catalog/image-constants.ts — shared constants for the SKU product-image
// pipeline (lib/catalog/image-client.ts resize step, lib/actions/catalog-
// images.ts server action, lib/actions/catalog.ts's primary-image lookup).
//
// Plain module — no "use server" here on purpose. This file is imported by
// BOTH a "use server" actions file and (in the next round) client
// components; a "use server" file may only export async functions, so any
// `export const` living there breaks the build (lesson from commit
// 0ae940d, same reasoning lib/labels/constants.ts documents).

/** Hard server-side ceiling per SKU, enforced by both
 * lib/actions/catalog-images.ts (app-layer count check) AND a DB trigger
 * (supabase/migrations/0104, defense against a concurrent-upload race).
 * NOTE: the owner's stated UI target is "<=5 รูป/SKU" (fewer shown at once)
 * — 8 is deliberately higher headroom for the hard ceiling, not a
 * contradiction of that UI number. Flagged in the handoff report in case
 * this reflects a documentation drift rather than an intentional gap. */
export const MAX_IMAGES_PER_SKU = 8;

/** Long-edge cap, in pixels, for the "md" variant — used for print/email
 * (quotes, line sheets) where a larger image is worth the extra bytes. */
export const MD_MAX_PX = 1200;

/** Long-edge cap, in pixels, for the "sm" variant — thumbnails/list views. */
export const SM_MAX_PX = 480;

/** Per-file byte ceiling for EACH variant (md and sm are checked
 * independently) — matches storage.buckets.file_size_limit set on the
 * 'product-images' bucket in supabase/migrations/0104_product_images.sql.
 * Keep these two numbers in sync if either ever changes. */
export const MAX_BYTES = 1_048_576; // 1MB

export const BUCKET = "product-images";

/**
 * Builds the public URL for an uploaded image path. Single source of truth
 * for this construction — design §7: "ใบเสนอราคา/อีเมล/line sheet จะใช้ตัว
 * เดียวกัน อย่าให้แต่ละที่ประกอบ URL เอง". Deliberately uses the NEXT_PUBLIC_
 * env var (not the server-only SUPABASE_URL) so this same function works
 * from both server code (quote/email rendering) and client components
 * (catalog gallery `<img src>`) without needing two versions.
 *
 * Returns null (never throws) when there's no path or the env var is
 * missing — callers should treat that as "no image", not a hard error; a
 * misconfigured env shouldn't crash a page that just wants to render a
 * product card.
 */
export function publicImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
}
