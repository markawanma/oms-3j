// ContentTypeChip — dot+label outline pill for analytics.content_type
// (design doc §3.1: "outline + dot เท่านั้น ห้าม solid fill แม้แต่ตัวเดียวใน
// ทั้ง 5 สี"). content_type's own seed data (0145) makes `drive_live`'s hex
// (#a2191d) match `bg-primary-600` exactly — solid-filling any content type
// color would read as "selected/primary action" instead of "content
// category". Shape (hollow pill vs. solid Badge/Button) is what keeps the
// two vocabularies apart even when a color collides.
//
// 🔴 Colors MUST be inline style, not a Tailwind class built from a runtime
// string (`bg-[${hex}]`) — Tailwind only scans literal class strings at
// build time, so a class assembled from a DB value never gets generated and
// the color silently disappears in production (repo-wide rule, hit 3x in one
// day per the brief). Every color here goes through style={{ ... }}.

import type { ContentTypeRow } from "@/lib/marketing/content-types";

export function ContentTypeChip({
  contentType,
  className = "",
}: {
  contentType: Pick<ContentTypeRow, "labelTh" | "colorHex">;
  className?: string;
}) {
  return (
    <span
      style={{ borderColor: contentType.colorHex }}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-zinc-700 ${className}`}
    >
      <span style={{ backgroundColor: contentType.colorHex }} className="h-2 w-2 shrink-0 rounded-full" aria-hidden="true" />
      {contentType.labelTh}
    </span>
  );
}

/** design §3.3: opened once at the top of a section (e.g. CampaignBoard),
 * explains all active content types so individual chips don't need to
 * repeat the explanation — same <details> pattern as CampaignCalendar's
 * prep_note_th accordion. */
export function ContentTypeLegend({ contentTypes }: { contentTypes: ContentTypeRow[] }) {
  if (contentTypes.length === 0) return null;
  return (
    <details className="rounded-md border border-zinc-100 bg-white">
      <summary className="min-h-9 cursor-pointer select-none px-2.5 py-1.5 text-xs font-semibold text-zinc-600">
        ประเภทเนื้อหาคืออะไร
      </summary>
      <div className="flex flex-wrap gap-1.5 border-t border-zinc-100 p-2.5">
        {contentTypes.map((ct) => (
          <ContentTypeChip key={ct.code} contentType={ct} />
        ))}
      </div>
    </details>
  );
}
