// lib/labels/formats/tiktok.ts — TikTok shipping-label parser (design §6,
// P1 scope: "P1 ทำ TikTok ตัวเดียว" — 2,721/2,841 = 96% of the TH-XX backlog).
// Plain module (no "use server").
//
// design §6: detect from the tracking-number pattern (JTTH\d{10,}) + a
// format-specific marker; design §4 rule 7: a page with >1 distinct tracking
// number extracted is ambiguous -> needs_review (not this module's job to
// decide the final match_status, just to report the raw signal).

const TRACKING_PATTERN = "JTTH\\d{10,}";

export interface LabelExtractResult {
  trackingNo: string | null;
  /** true when >1 DISTINCT tracking numbers were found on the page (design §4
   * rule 7) — trackingNo is null in that case; caller must route to
   * needs_review regardless of any province match outcome. */
  ambiguous: boolean;
}

export interface LabelFormat {
  id: string;
  detect(pageText: string): boolean;
  extract(pageText: string): LabelExtractResult;
}

// Fresh RegExp instance per call — cheap at this volume (hundreds of pages
// per file) and avoids any shared-mutable-lastIndex footgun from reusing one
// global-flag regex object across detect()/extract() calls.
function uniqueTrackingNumbers(pageText: string): string[] {
  const matches = pageText.match(new RegExp(TRACKING_PATTERN, "g")) ?? [];
  return [...new Set(matches)];
}

export const tiktokFormat: LabelFormat = {
  id: "tiktok",
  detect(pageText: string): boolean {
    return new RegExp(TRACKING_PATTERN).test(pageText);
  },
  extract(pageText: string): LabelExtractResult {
    const unique = uniqueTrackingNumbers(pageText);
    if (unique.length === 1) {
      return { trackingNo: unique[0], ambiguous: false };
    }
    // 0 matches (shouldn't happen if detect() returned true, but defensive)
    // or >1 distinct matches (design §4 rule 7) both come back as "no single
    // answer" — ambiguous only flags the >1 case specifically so the caller
    // can tell "genuinely nothing found" apart from "found too many."
    return { trackingNo: null, ambiguous: unique.length > 1 };
  },
};
