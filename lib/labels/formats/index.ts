// lib/labels/formats/index.ts — parser registry (design §6). Adding a new
// marketplace format = add one file here + one line in LABEL_FORMATS, no
// other file needs to change.
import { tiktokFormat, type LabelFormat } from "./tiktok";

export type { LabelFormat, LabelExtractResult } from "./tiktok";

// P1 scope: TikTok only (design §6 — "P1 ทำ TikTok ตัวเดียว", 96% of the
// backlog). Shopee is P2.
export const LABEL_FORMATS: LabelFormat[] = [tiktokFormat];

/** First registered format whose detect() matches, or null if none do —
 * null means match_status='undetected' for that page (design §"เคสห้ามผ่าน"
 * — "detect ไม่ได้ = นับใน summary ไม่เงียบ"). */
export function detectFormat(pageText: string): LabelFormat | null {
  for (const format of LABEL_FORMATS) {
    if (format.detect(pageText)) return format;
  }
  return null;
}
