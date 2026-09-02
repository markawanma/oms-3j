// lib/catalog/image-client.ts — browser-only image resize pipeline for the
// SKU product-image upload feature. Plain module (no "use client"/"use
// server" directive needed — it exports functions, not a component; the
// component that calls it, in the next frontend round, will carry "use
// client" itself since createImageBitmap/canvas only exist in a browser).
//
// Produces two JPEG variants per source File: "md" (long edge <= MD_MAX_PX,
// for print/email) and "sm" (long edge <= SM_MAX_PX, for thumbnails).
// Forcing JPEG output (never WebP/AVIF) is required because Outlook can't
// render either — this is a structural choice (canvas.toBlob only ever
// asked for 'image/jpeg' below), not a convention someone has to remember.
// A side effect of re-encoding through canvas: ALL metadata is stripped,
// including EXIF GPS coordinates that mobile photos commonly embed — that
// is load-bearing here (a customer-facing quote email must never leak where
// a product photo was taken), not an incidental cleanup.
//
// Only the pure, non-canvas pieces (calcTargetDimensions, isHeicFile,
// QUALITY_STEPS) are unit-tested — see image-client.test.ts. The
// canvas/createImageBitmap path can't run under Vitest's node environment
// (vitest.config.ts), so resizeImageVariant/resizeProductImage are exercised
// manually by frontend-dev once the upload UI exists.

import { MAX_BYTES, MD_MAX_PX, SM_MAX_PX } from "./image-constants";

export class HeicNotSupportedError extends Error {
  constructor() {
    super("HEIC_NOT_SUPPORTED");
    this.name = "HeicNotSupportedError";
  }
}

export class ImageTooLargeError extends Error {
  constructor(public readonly bytes: number) {
    super("IMAGE_TOO_LARGE");
    this.name = "ImageTooLargeError";
  }
}

export class ImageDecodeError extends Error {
  constructor(cause: unknown) {
    super(`IMAGE_DECODE_FAILED: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ImageDecodeError";
  }
}

const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif"]);
const HEIC_EXTENSIONS = [".heic", ".heif"];

/**
 * HEIC/HEIF detection — checked BEFORE any createImageBitmap() call, since
 * browser HEIC decode support is inconsistent (some browsers silently fail,
 * others throw a generic error) and iOS Safari sometimes hands over a File
 * with an EMPTY `.type` for a HEIC photo (design brief: "iOS บางทีส่ง mime
 * ว่าง") — checking the extension too catches that case the mime check
 * alone would miss.
 */
export function isHeicFile(file: { type: string; name: string }): boolean {
  if (HEIC_MIME_TYPES.has(file.type.toLowerCase())) return true;
  const lowerName = file.name.toLowerCase();
  return HEIC_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

/**
 * Pure — computes the output size for a long-edge-constrained resize,
 * keeping aspect ratio and never upscaling (a source image already smaller
 * than maxPx is returned at its original size unchanged).
 */
export function calcTargetDimensions(
  width: number,
  height: number,
  maxPx: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0 || maxPx <= 0) return { width: 0, height: 0 };
  const longEdge = Math.max(width, height);
  if (longEdge <= maxPx) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxPx / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Quality ladder tried in order until the encoded blob fits MAX_BYTES.
 * Tech Lead decision (design brief): "ถ้าย่อแล้วยังเกิน 1MB ให้ลดคุณภาพลงทีละ
 * ขั้น ... ก่อนจะยอมแพ้ — ปฏิเสธทันทีคือโยนปัญหากลับให้ผู้ใช้ทั้งที่ระบบแก้เองได้"
 * — exported so the encode loop and its test stay in lockstep with the
 * documented ladder.
 */
export const QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6] as const;

export interface ResizedImage {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  quality: number;
}

async function encodeAtQuality(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("encodeAtQuality: canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encodeAtQuality: canvas.toBlob returned null"))),
      "image/jpeg",
      quality
    );
  });
}

/**
 * Resizes+re-encodes one source File into a single JPEG variant capped at
 * `maxPx` on the long edge and MAX_BYTES total bytes, stepping quality down
 * through QUALITY_STEPS before giving up.
 *
 * Throws HeicNotSupportedError before touching canvas at all if the file
 * looks like HEIC/HEIF. Throws ImageDecodeError if createImageBitmap can't
 * decode the file (corrupt image / genuinely unsupported format). Throws
 * ImageTooLargeError if every quality step still exceeds MAX_BYTES at this
 * resolution — per the Tech Lead decision above, that's the point where the
 * system has legitimately tried and the caller should surface a clear error
 * rather than looping forever or silently shipping an oversized file (the
 * server-side gate in lib/actions/catalog-images.ts would just reject it
 * anyway).
 */
export async function resizeImageVariant(file: File, maxPx: number): Promise<ResizedImage> {
  if (isHeicFile(file)) throw new HeicNotSupportedError();

  let bitmap: ImageBitmap;
  try {
    // imageOrientation: 'from-image' bakes the EXIF orientation tag into the
    // decoded pixels so a portrait iPhone photo isn't rendered sideways —
    // without this option, canvas ignores EXIF orientation entirely and the
    // output would be rotated.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (err) {
    throw new ImageDecodeError(err);
  }

  try {
    const { width, height } = calcTargetDimensions(bitmap.width, bitmap.height, maxPx);
    if (width === 0 || height === 0) {
      throw new ImageDecodeError(new Error("source image has zero dimensions"));
    }

    let last: Blob | null = null;
    for (const quality of QUALITY_STEPS) {
      const blob = await encodeAtQuality(bitmap, width, height, quality);
      last = blob;
      if (blob.size <= MAX_BYTES) {
        return { blob, width, height, bytes: blob.size, quality };
      }
    }
    throw new ImageTooLargeError(last ? last.size : 0);
  } finally {
    bitmap.close();
  }
}

export interface ProductImageVariants {
  md: ResizedImage;
  sm: ResizedImage;
}

/**
 * Produces both variants (md + sm) from one source File — the pair the
 * server action's FormData contract expects (`productId, md, sm`). Decodes
 * the source file twice (once per variant) rather than sharing one
 * ImageBitmap across both encodes; simpler and safe (createImageBitmap
 * accepts a File directly and each decode is independent), and the extra
 * decode cost is negligible for a single admin-triggered upload.
 */
export async function resizeProductImage(file: File): Promise<ProductImageVariants> {
  const [md, sm] = await Promise.all([resizeImageVariant(file, MD_MAX_PX), resizeImageVariant(file, SM_MAX_PX)]);
  return { md, sm };
}
