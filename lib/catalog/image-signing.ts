// lib/catalog/image-signing.ts — server-side signed-URL helpers for the
// PRIVATE 'product-images' storage bucket (supabase/migrations/
// 0105_product_images_private.sql flipped it private; see that file's
// header for why signed URLs, not a public bucket + re-encoding, was the
// fix chosen this round).
//
// Plain module (no "use server") — imported by BOTH lib/actions/
// catalog-images.ts and lib/actions/catalog.ts, which are "use server"
// files that may only export async functions themselves; shared helpers
// that aren't actions in their own right live here instead, same pattern as
// lib/supabase/query-limits.ts's fetchAllRows().
//
// Every function here degrades to null/an-empty-map on failure — NEVER
// throws. A broken thumbnail is an acceptable outcome; failing an entire
// /catalog page load over one unsignable image is not (same "informational,
// never blocking" precedent as width/height parse failures in
// lib/catalog/image-server.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET } from "@/lib/catalog/image-constants";

/** TTL for every signed URL this app hands out for product images. 1 hour
 * comfortably outlives a single page view or admin session without needing
 * a refresh loop, while staying short enough that a URL copied out of
 * devtools stops working well within the same business day. Change this
 * constant (not individual call sites) if that trade-off ever needs to
 * move — and see 0105's header for why long-lived public links (outbound
 * OEM quote/email documents) are a SEPARATE future feature, not a reason to
 * stretch this TTL. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Signs ONE storage path. Prefer signImagePaths() (below) whenever more
 * than one path needs signing in the same request — this one exists for the
 * single-row case (e.g. immediately after a fresh upload, before the next
 * getProductImages() read-back would naturally batch it).
 */
export async function signImagePath(
  supabase: SupabaseClient,
  path: string | null | undefined
): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch (err) {
    console.error("signImagePath failed", err, { path });
    return null;
  }
}

/**
 * Batch-signs many paths in ONE Storage API call (createSignedUrls,
 * plural) — do NOT loop signImagePath() over a row set. getProducts()
 * renders up to ~303 SKUs x 2 variants = ~600 paths on a single page load;
 * 600 individual signing round trips would be slow and risks getting
 * rate-limited by Storage for no benefit. Returns a Map keyed by the EXACT
 * path string that was requested, containing only paths that were both
 * requested and successfully signed — callers look up by path and treat a
 * missing key the same as "no image" (never a hard error for one bad row).
 */
export async function signImagePaths(
  supabase: SupabaseClient,
  paths: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(paths.filter((p): p is string => Boolean(p))));
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      console.error("signImagePaths: batch signing failed", error, { count: unique.length });
      return result;
    }
    for (const entry of data) {
      // Per-item shape: { path, signedUrl, error }. A per-path failure
      // (e.g. the object was deleted between the DB read and this call)
      // shows up as entry.error, NOT a thrown exception — skip just that
      // one row rather than failing the whole batch.
      if (!entry.error && entry.signedUrl && entry.path) {
        result.set(entry.path, entry.signedUrl);
      }
    }
  } catch (err) {
    console.error("signImagePaths failed", err, { count: unique.length });
  }
  return result;
}
