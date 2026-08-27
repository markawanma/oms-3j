// lib/labels/constants-ui.ts — client-facing constants for the label-upload
// flow (components/domain/tiktok/UploadPageClient.tsx). Split out from the
// component so validation rules are easy to find/change in one place.
//
// P1 is PDF-only (design §0: text-layer parsing, no OCR — see
// docs/3j-jewelry/analytics/design-label-upload.md). JPG/PNG are rejected
// client-side with a reason, never silently dropped.

export const ACCEPTED_EXTENSIONS = ["pdf"];

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB — matches design §3 body-size-limit workaround (signed URL, not action body)

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)}KB`;
  return `${bytes}B`;
}
