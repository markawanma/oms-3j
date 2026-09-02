"use server";

// lib/actions/catalog-images.ts — server actions backing the SKU
// product-image upload feature (design approved by Tech Lead; backed by
// supabase/migrations/0104_product_images.sql). Data/logic layer only — the
// upload UI itself is frontend-dev's next round.
//
// Same auth model as lib/actions/catalog.ts / labels.ts: getServiceClient()
// uses the service role (BYPASSES RLS) — requireOwnerAdmin() is the only
// application-level gate, and it only gates WRITES (reads are open to every
// dev role, same as getProducts()/getSkuOrderAlerts() in catalog.ts).
//
// ⚠️ This app has no real auth yet (middleware.ts gate is off, production is
// publicly reachable — see memory "Prod exposure: accepted risk"). That
// means requireOwnerAdmin() cannot keep an outside caller from hitting these
// actions at all; it only distinguishes "staff" from "owner/admin" for
// someone who already has the app open. The checks that actually hold up
// against ANY caller are: magic-byte JPEG verification, the per-file byte
// ceiling, the MAX_IMAGES_PER_SKU cap (app-layer here AND a DB trigger,
// 0104), and the product-belongs-to-this-shop lookup. Every one of those
// runs on every write below — do not remove any of them.
//
// This module is "use server" + async-function-exports ONLY (lesson from
// 0ae940d: `export const` in a "use server" file breaks the build) — every
// constant/type lives in lib/catalog/image-constants.ts (plain module)
// instead, and the JPEG byte-parsing helpers live in lib/catalog/
// image-server.ts (also plain, and unit-testable there).

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import { BUCKET, MAX_BYTES, MAX_IMAGES_PER_SKU } from "@/lib/catalog/image-constants";
import { extractJpegDimensions, looksLikeJpeg } from "@/lib/catalog/image-server";
import { signImagePaths } from "@/lib/catalog/image-signing";
import type { ProductImageRow } from "@/lib/catalog/types";

const JPEG_CONTENT_TYPE = "image/jpeg";

function requireOwnerAdmin(): ActionResult<never> | null {
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่จัดการรูปสินค้าได้" };
  }
  return null;
}

function revalidateCatalogPaths(): void {
  revalidatePath("/catalog");
}

// ============================================================================
// getProductImages — full gallery for one product, in display order.
//
// OWN ADDITION beyond the 3 functions the design brief lists explicitly
// (uploadProductImage / deleteProductImage / reorderProductImages): without
// a way to list a product's existing images, frontend-dev's next round has
// no data to build the "existing images" panel from, and reorderProductImages
// has nothing to reorder from the UI's perspective. Read-only, no schema
// change, same low-risk shape as getSkuOrderAlerts()/getProducts() in
// catalog.ts (no requireOwnerAdmin() gate — reads are open to every role).
// Flagged in the handoff report as a decision beyond the literal design.
// ============================================================================

export async function getProductImages(productId: string): Promise<ActionResult<ProductImageRow[]>> {
  const cleanProductId = (productId ?? "").trim();
  if (!cleanProductId) return { ok: false, error: "ไม่พบสินค้าที่จะดูรูป" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    // Well under PostgREST's max-rows cap even at the full 8-image ceiling
    // — fetchAllRows() (lib/supabase/query-limits.ts) is unnecessary here.
    const { data, error } = await supabase
      .from("product_image")
      .select("id, product_id, storage_path, variant_sm_path, sort_order, width, height, bytes, created_at")
      .eq("shop_id", shopId)
      .eq("product_id", cleanProductId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;

    const imageRows = (data ?? []) as {
      id: string;
      product_id: string;
      storage_path: string;
      variant_sm_path: string;
      sort_order: number;
      width: number | null;
      height: number | null;
      bytes: number | null;
      created_at: string;
    }[];

    // Batch-sign ALL paths for this product in ONE Storage call (private
    // bucket, 0105) — at most 16 paths even at the 8-image ceiling, but the
    // discipline is the same as getProducts()'s 303-row case: never loop a
    // per-row signing call.
    const signedByPath = await signImagePaths(
      supabase,
      imageRows.flatMap((r) => [r.storage_path, r.variant_sm_path])
    );

    const rows: ProductImageRow[] = imageRows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      mdUrl: signedByPath.get(r.storage_path) ?? null,
      smUrl: signedByPath.get(r.variant_sm_path) ?? null,
      sortOrder: r.sort_order,
      width: r.width,
      height: r.height,
      bytes: r.bytes,
      createdAt: r.created_at,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getProductImages failed", err);
    return { ok: false, error: "โหลดรูปสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// uploadProductImage — validate md+sm JPEGs -> tenant/product check -> count
// cap -> upload both objects to storage -> insert product_image row.
//
// FormData contract (frontend-dev, next round): { productId: string,
// md: File, sm: File } — both already resized+re-encoded to JPEG client-side
// via lib/catalog/image-client.ts's resizeProductImage(). This action does
// NOT trust that client-side work happened correctly: magic bytes and size
// are re-checked here against the actual bytes received.
// ============================================================================

export interface UploadProductImageResult {
  imageId: string;
  /** SIGNED URL (1hr TTL) for the md variant, ready to render — null only
   * if signing failed right after a successful upload (never blocks the
   * upload itself; the row exists either way, a later getProductImages()
   * call will re-sign it). Bucket is PRIVATE (0105), so a raw path is not
   * useful to the caller anymore. */
  mdUrl: string | null;
  smUrl: string | null;
}

export async function uploadProductImage(fd: FormData): Promise<ActionResult<UploadProductImageResult>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const productId = String(fd.get("productId") ?? "").trim();
  const mdFile = fd.get("md");
  const smFile = fd.get("sm");

  if (!productId) return { ok: false, error: "ไม่พบสินค้าที่จะอัปโหลดรูป" };
  if (!(mdFile instanceof File) || !(smFile instanceof File)) {
    return { ok: false, error: "ไม่พบไฟล์รูปที่จะอัปโหลด (ต้องมีทั้งรูปขนาดกลางและรูปย่อ)" };
  }
  if (mdFile.size === 0 || smFile.size === 0) {
    return { ok: false, error: "ไฟล์รูปว่างเปล่า" };
  }
  if (mdFile.size > MAX_BYTES || smFile.size > MAX_BYTES) {
    return { ok: false, error: `ไฟล์รูปใหญ่เกิน ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB` };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    // Tenant isolation — the product must exist in THIS shop, not just
    // exist somewhere. Also doubles as the "product ต้องมีอยู่จริง" gate.
    const { data: product, error: productErr } = await supabase
      .from("product")
      .select("id")
      .eq("id", productId)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (productErr) throw productErr;
    if (!product) return { ok: false, error: "ไม่พบสินค้านี้ในร้าน" };

    // App-layer count check — cheap, catches the common case fast. The DB
    // trigger (0104) is the structural backstop against a concurrent-upload
    // race this check alone can't close (see that migration's header
    // comment).
    const { count: existingCount, error: countErr } = await supabase
      .from("product_image")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("product_id", productId);
    if (countErr) throw countErr;
    if ((existingCount ?? 0) >= MAX_IMAGES_PER_SKU) {
      return { ok: false, error: `สินค้านี้มีรูปครบ ${MAX_IMAGES_PER_SKU} รูปแล้ว — ลบรูปเก่าก่อนอัปโหลดเพิ่ม` };
    }

    const mdBytes = new Uint8Array(await mdFile.arrayBuffer());
    const smBytes = new Uint8Array(await smFile.arrayBuffer());

    // Never trust the client's declared Content-Type/extension — verify the
    // actual bytes (FF D8 FF = JPEG SOI + start of the first marker).
    if (!looksLikeJpeg(mdBytes) || !looksLikeJpeg(smBytes)) {
      return { ok: false, error: "ไฟล์ไม่ใช่ JPEG จริง (magic bytes ไม่ตรง) — อัปโหลดใหม่" };
    }

    // Informational only (0104 column comment) — a failed parse degrades to
    // null width/height, never blocks the upload.
    const dims = extractJpegDimensions(mdBytes);

    // uuid ล้วนที่ server สร้างเอง — SKU (มีอักขระไทย/อักขระซ่อน) ต้องไม่เข้าใกล้
    // ชื่อไฟล์เด็ดขาด (บทเรียนจริง — เพิ่งแก้ปัญหานี้ไปทั้งวัน).
    //
    // product.id (from the DB read above), NOT the raw `productId` request
    // field — M2 fix (security audit 2026-09-02). Both hold the same value
    // whenever this line is reached (the query above matched on exact
    // equality), but product.id is the DB-verified/canonicalized form; using
    // it here means the storage path is never built from an unvalidated
    // client string, even though today's uuid column type already rejects
    // the `/`/`..` path-traversal payloads that would matter ("accidentally
    // safe" is not the same as "designed safe").
    const imageId = randomUUID();
    const mdPath = `${shopId}/${product.id}/${imageId}_md.jpg`;
    const smPath = `${shopId}/${product.id}/${imageId}_sm.jpg`;

    // cacheControl "60" (seconds) — M1 fix: the default is 3600s, which
    // means deleteProductImage()'s storage removal wouldn't actually stop
    // the CDN serving the old bytes for up to an hour. 60s bounds that
    // window without meaningfully hurting cache hit rate for a gallery that
    // rarely repaints within a minute.
    const { error: mdUploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(mdPath, mdBytes, { contentType: JPEG_CONTENT_TYPE, upsert: false, cacheControl: "60" });
    if (mdUploadErr) throw mdUploadErr;

    const { error: smUploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(smPath, smBytes, { contentType: JPEG_CONTENT_TYPE, upsert: false, cacheControl: "60" });
    if (smUploadErr) {
      // Roll back the md object we just uploaded — don't leave an orphan
      // file in storage with no DB row pointing to it.
      await supabase.storage
        .from(BUCKET)
        .remove([mdPath])
        .catch((rollbackErr) => console.error("uploadProductImage: rollback of md object also failed", rollbackErr));
      throw smUploadErr;
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("product_image")
      .insert({
        shop_id: shopId,
        product_id: productId,
        storage_path: mdPath,
        variant_sm_path: smPath,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        bytes: mdBytes.byteLength,
      })
      .select("id")
      .single();
    if (insertErr) {
      // Roll back both storage objects — insert failed, most likely one of
      // the DB-level cap triggers (0104/0105) firing on a race with a
      // concurrent upload (P0001 = this SKU's 8-image cap; P0003 = this
      // shop's 1200-image-total cap, 0105).
      await supabase.storage
        .from(BUCKET)
        .remove([mdPath, smPath])
        .catch((rollbackErr) => console.error("uploadProductImage: rollback of storage objects also failed", rollbackErr));
      const code = (insertErr as { code?: string }).code;
      if (code === "P0001") {
        return { ok: false, error: `สินค้านี้มีรูปครบ ${MAX_IMAGES_PER_SKU} รูปแล้ว — ลบรูปเก่าก่อนอัปโหลดเพิ่ม` };
      }
      if (code === "P0003") {
        return { ok: false, error: "พื้นที่รูปสินค้าของร้านเต็มแล้ว — ลบรูปเก่าที่ไม่ใช้แล้วก่อนอัปโหลดเพิ่ม" };
      }
      throw insertErr;
    }

    // Signed URLs for the row just inserted — lets the caller render the
    // new image immediately without a round trip through getProductImages().
    // Never blocks a successful upload: a signing failure here just means
    // mdUrl/smUrl come back null (row still exists, re-signed correctly on
    // the next read). One batch call for both paths (same discipline as
    // getProductImages/getProducts — never loop signing calls, even when
    // there are only 2 paths here).
    const signedByPath = await signImagePaths(supabase, [mdPath, smPath]);
    const mdUrl = signedByPath.get(mdPath) ?? null;
    const smUrl = signedByPath.get(smPath) ?? null;

    revalidateCatalogPaths();
    return { ok: true, data: { imageId: String(inserted.id), mdUrl, smUrl } };
  } catch (err) {
    console.error("uploadProductImage failed", err);
    return { ok: false, error: "อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// deleteProductImage — delete the DB row first, then the storage objects
// (same order/trade-off as deleteProduct in catalog.ts: if storage cleanup
// fails after the row is gone, that's a leaked-file problem to clean up
// later, not a correctness problem the user should be blocked on — the DB
// row is what the UI/rest of the app treats as truth). "แทนรูป" (replace) is
// composed by the caller as deleteProductImage(old) + uploadProductImage
// (new) — a fresh uuid path every time, never an overwrite of the old path
// (keeps stale CDN-cached URLs from ever pointing at new content).
// ============================================================================

export async function deleteProductImage(imageId: string): Promise<ActionResult<null>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanId = (imageId ?? "").trim();
  if (!cleanId) return { ok: false, error: "ไม่พบรูปที่จะลบ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data: row, error: rowErr } = await supabase
      .from("product_image")
      .select("id, storage_path, variant_sm_path")
      .eq("id", cleanId)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (rowErr) throw rowErr;
    if (!row) return { ok: false, error: "ไม่พบรูปนี้ในร้าน" };

    const { error: delErr } = await supabase
      .from("product_image")
      .delete()
      .eq("id", cleanId)
      .eq("shop_id", shopId);
    if (delErr) throw delErr;

    const { error: removeErr } = await supabase.storage
      .from(BUCKET)
      .remove([row.storage_path, row.variant_sm_path]);
    if (removeErr) {
      console.error("deleteProductImage: row deleted but storage cleanup failed", removeErr, {
        imageId: cleanId,
        paths: [row.storage_path, row.variant_sm_path],
      });
    }

    revalidateCatalogPaths();
    return { ok: true, data: null };
  } catch (err) {
    console.error("deleteProductImage failed", err);
    return { ok: false, error: "ลบรูปไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// reorderProductImages — sets sort_order = array index for every id in
// imageIds. Rejects unless imageIds is EXACTLY the current set of image ids
// for this product (no partial reorder, no ids borrowed from another
// product, no duplicates) — a mismatch means the client's view is stale.
// ============================================================================

export async function reorderProductImages(
  productId: string,
  imageIds: string[]
): Promise<ActionResult<null>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanProductId = (productId ?? "").trim();
  if (!cleanProductId) return { ok: false, error: "ไม่พบสินค้าที่จะจัดเรียงรูป" };
  if (!Array.isArray(imageIds) || imageIds.length === 0) {
    return { ok: false, error: "ไม่มีรายการรูปที่จะจัดเรียง" };
  }

  const cleanIds = imageIds.map((id) => (id ?? "").trim());
  if (cleanIds.some((id) => !id) || new Set(cleanIds).size !== cleanIds.length) {
    return { ok: false, error: "รายการรูปที่ส่งมาไม่ถูกต้อง (มีค่าว่างหรือซ้ำ)" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data: existing, error: existingErr } = await supabase
      .from("product_image")
      .select("id")
      .eq("shop_id", shopId)
      .eq("product_id", cleanProductId);
    if (existingErr) throw existingErr;

    const existingIds = new Set(((existing ?? []) as { id: string }[]).map((r) => r.id));
    const requestedIds = new Set(cleanIds);
    const sameSet =
      existingIds.size === requestedIds.size && [...existingIds].every((id) => requestedIds.has(id));
    if (!sameSet) {
      return { ok: false, error: "รายการรูปไม่ตรงกับข้อมูลปัจจุบัน — โหลดหน้าใหม่แล้วลองอีกครั้ง" };
    }

    // supabase-js has no single-call "bulk update, different value per row"
    // — sequential updates, same trade-off documented in
    // lib/actions/labels.ts (no multi-statement transaction primitive here).
    // N is capped at MAX_IMAGES_PER_SKU (8), so this is cheap; a failure
    // partway through leaves a partial reorder rather than rolling back —
    // acceptable for a display-order field with no financial/legal weight,
    // unlike the oem-quote-invariants domain.
    for (let i = 0; i < cleanIds.length; i++) {
      const { error: updErr } = await supabase
        .from("product_image")
        .update({ sort_order: i })
        .eq("id", cleanIds[i])
        .eq("shop_id", shopId)
        .eq("product_id", cleanProductId);
      if (updErr) throw updErr;
    }

    revalidateCatalogPaths();
    return { ok: true, data: null };
  } catch (err) {
    console.error("reorderProductImages failed", err);
    return { ok: false, error: "จัดเรียงรูปไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
