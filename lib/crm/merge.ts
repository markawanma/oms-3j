// lib/crm/merge.ts — const/type shared by the merge-candidate write layer
// (lib/actions/crm.ts) and its client UI (MergeCandidateList). Kept OUT of
// lib/actions/crm.ts for the same reason lib/crm/segments.ts and
// lib/crm/order-override.ts are: that file is "use server" and may only
// export async functions (invalid-use-server-value build error otherwise).

import type { BadgeTone } from "@/components/ui/Badge";

/** Mirrors analytics.v_merge_candidate.confidence — see
 * docs/3j-jewelry/analytics/phase-b-crm-design.md §3. Rows are pre-sorted
 * high -> medium -> low by the view itself. */
export type MergeConfidence = "high" | "medium" | "low";

export const MERGE_CONFIDENCE_LABEL_TH: Record<MergeConfidence, string> = {
  high: "สูง",
  medium: "กลาง",
  low: "ต่ำ",
};

export const MERGE_CONFIDENCE_TONE: Record<MergeConfidence, BadgeTone> = {
  high: "red",
  medium: "amber",
  low: "slate",
};

/** One side (A or B) of a merge candidate pair. */
export interface MergeCandidateSide {
  customerId: string;
  name: string | null;
  identities: string[];
  province: string | null;
  orderCount: number;
  revenueSum: number;
}

export interface CrmMergeCandidateRow {
  a: MergeCandidateSide;
  b: MergeCandidateSide;
  confidence: MergeConfidence;
}
