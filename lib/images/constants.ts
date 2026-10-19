// lib/images/constants.ts (เดิม lib/catalog/image-constants.ts) — shared constants for the SKU product-image pipeline (lib/images/client.ts resize step,
// lib/actions/catalog-images.ts server action, lib/actions/catalog.ts's primary-image lookup) AND the job-photo pipeline (lib/actions/job-photos.ts · 0182).
//
// Plain module — no "use server" here on purpose. This file is imported by
// BOTH a "use server" actions file and (in the next round) client
// components; a "use server" file may only export async functions, so any
// `export const` living there breaks the build (lesson from commit
// 0ae940d, same reasoning lib/labels/constants.ts documents).

/** Hard server-side ceiling per SKU, enforced by both
 * lib/actions/catalog-images.ts (app-layer count check) AND a DB trigger
 * (product_image_enforce_cap, defense against a concurrent-upload race).
 *
 * 🔴 THIS NUMBER LIVES IN TWO PLACES. Changing it here is half the job — the
 * trigger has its own literal. Ship a migration in the same change, or the
 * app and the database will disagree: the form will happily offer a slot the
 * database then refuses, and the user sees an error with no way to act on it.
 * Last moved 2026-09-02 (8 -> 4, owner's call) via 0106_product_image_cap_4. */
export const MAX_IMAGES_PER_SKU = 4;

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

// publicImageUrl() used to live here (built a `/storage/v1/object/public/...`
// URL directly from a raw storage path). Removed in the 2026-09-02 security
// fix (supabase/migrations/0105_product_images_private.sql): the bucket is
// now PRIVATE, so that URL shape 404s for every path — keeping the function
// around would have been dead code that actively lies to the next reader.
// Rendering a product image now goes through a SIGNED URL, produced
// server-side by lib/catalog/image-signing.ts and returned directly from
// the read actions (getProducts/getProductImages in lib/actions/catalog*.ts)
// — callers render `row.mdUrl`/`row.smUrl`/`row.primaryImageUrl` etc.
// straight from those results, they never construct a URL from a path
// themselves anymore.

// ============================================================================
// รูปอ้างอิงบนใบงาน (0182 · design-job-photos.md §2.3) — bucket private 'job-photos'
// ============================================================================

export const JOB_PHOTOS_BUCKET = "job-photos";

/** รูป reference ต่อใบ (เพดานที่ DB: trigger analytics.job_photo_enforce_cap — มติเจ้าของ 17-18 ต.ค. 69)
 * 🔴 THIS NUMBER LIVES IN TWO PLACES (เหมือน MAX_IMAGES_PER_SKU): ขยับที่นี่ครึ่งเดียว = ฟอร์มเสนอช่องที่ DB ปฏิเสธ — ต้องออก migration ใหม่คู่กัน */
export const MAX_REFERENCE_PHOTOS = 5;

/** รูปทุกชนิดรวมต่อใบ (reference + stage ของ W2b) — 🔴 2 ที่เช่นกัน (trigger เดียวกัน) */
export const MAX_JOB_PHOTOS = 20;

/** budget bytes ของ md ต่อร้าน (sm ≈ ⅓ ⇒ ~330 MB บนดิสก์) — 🔴 2 ที่เช่นกัน (trigger เดียวกัน · P0003) */
export const JOB_PHOTOS_BUDGET_BYTES = 250 * 1024 * 1024;

/** TTL ของ signed URL รูปใบงาน (ออฟฟิศ + ช่าง + หน้าพิมพ์) — สั้นกว่า 1 ชม. ของแคตตาล็อก เพราะรูปแบบของลูกค้า OEM ถึงมือถือช่าง (design §3.1) */
export const JOB_PHOTO_SIGNED_URL_TTL_S = 15 * 60;

/** caption ต่อรูป / เหตุผลที่ลบ (ตรงกับ CHECK ของ analytics.job_photo) */
export const JOB_PHOTO_CAPTION_MAX = 60;
export const JOB_PHOTO_REASON_MAX = 300;
