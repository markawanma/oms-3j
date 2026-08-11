// lib/tiktok/upload-simulation.ts — MOCK, UI-only. There is no real
// upload/parse backend yet (design §8 open question #1: OCR/LLM-vision vs.
// template+regex parser is still undecided — it changes the whole latency
// model). This file fabricates a plausible queued→parsing→done/failed
// sequence purely client-side so UploadPageClient can drive the 4 UI states
// now. Real filenames/sizes come from the actual `File` objects the user
// picks (so the queue looks real) — everything downstream (progress ticks,
// pass/fail outcome, review-queue rows) is invented, never a real parse
// result. Swapping in a real backend later replaces this file + the timers
// in UploadPageClient; the component tree and types stay the same.

import type { UploadBatchSummary, UploadQueueItem, UploadReviewRow } from "@/lib/tiktok/types";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Date.now()}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)}KB`;
  return `${bytes}B`;
}

export const ACCEPTED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB, per design layout spec

/** Deterministic MOCK outcome: every 4th file (index 3, 7, 11, ...) "fails"
 * to parse, so the failed-file retry UI is reachable without a real
 * OCR/parser. Not a real quality signal — purely to exercise the UI path. */
export function shouldMockFail(indexInBatch: number): boolean {
  return indexInBatch > 0 && indexInBatch % 4 === 3;
}

/** Builds the initial "parsing" queue items from real File objects — only
 * fileName/size are real, the rest of the lifecycle is simulated. */
export function buildInitialQueue(files: File[]): UploadQueueItem[] {
  return files.map(
    (file): UploadQueueItem => ({
      id: nextId("upload-item"),
      fileName: file.name,
      metaText: `${formatFileSize(file.size)} · กำลังอ่าน…`,
      status: "parsing",
      progressPct: 0,
    })
  );
}

const REVIEW_ROW_TEMPLATES: Omit<UploadReviewRow, "id">[] = [
  { externalOrderId: "#TT-580341", issueType: "address_unclear", issueBadgeLabel: "ที่อยู่ไม่ชัด" },
  { externalOrderId: "#TT-580362", issueType: "sku_unknown", issueBadgeLabel: "SKU ไม่รู้จัก" },
  { externalOrderId: "#TT-580388", issueType: "recipient_name_error", issueBadgeLabel: "ชื่อผู้รับ parse ผิด" },
];

/** MOCK batch summary + review rows derived from a batch's predetermined
 * done/failed outcomes (known upfront via `shouldMockFail`, since nothing is
 * really being parsed). `outcomes[i]` corresponds to the i-th file in the
 * batch that was passed to `buildInitialQueue`. */
export function buildMockResult(outcomes: ("done" | "failed")[]): {
  summary: UploadBatchSummary;
  reviewQueue: UploadReviewRow[];
} {
  const failed = outcomes.filter((o) => o === "failed").length;
  const doneCount = outcomes.filter((o) => o === "done").length;

  // MOCK: up to 3 of the "done" files get flagged for review (illustrative,
  // not derived from any real field-confidence signal).
  const reviewCount = Math.min(doneCount, REVIEW_ROW_TEMPLATES.length);
  const reviewQueue = REVIEW_ROW_TEMPLATES.slice(0, reviewCount).map((t) => ({ ...t, id: nextId("review") }));

  // MOCK: only larger batches "contain" a duplicate, so small test uploads
  // don't always show a nonzero duplicate count.
  const duplicate = doneCount >= 6 ? 1 : 0;
  const success = Math.max(doneCount - reviewQueue.length - duplicate, 0);

  return {
    summary: { success, needsReview: reviewQueue.length, duplicate, failed },
    reviewQueue,
  };
}

export function mergeBatchSummary(prev: UploadBatchSummary | null, next: UploadBatchSummary): UploadBatchSummary {
  if (!prev) return next;
  return {
    success: prev.success + next.success,
    needsReview: prev.needsReview + next.needsReview,
    duplicate: prev.duplicate + next.duplicate,
    failed: prev.failed + next.failed,
  };
}
