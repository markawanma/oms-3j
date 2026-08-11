import type { UploadBatchSummary } from "@/lib/tiktok/types";

// duplicate uses `blue` (info-ish, not reserved) and failed uses `red`
// (genuine failure = the one case in this module where red is legitimate —
// design system rule reserves red for "danger/error", and a parse failure
// is exactly that, unlike e.g. a KPI trending down).
const CARDS: { key: keyof UploadBatchSummary; label: string; toneClass: string }[] = [
  { key: "success", label: "สำเร็จ", toneClass: "text-green-600" },
  { key: "needsReview", label: "ต้อง review", toneClass: "text-amber-600" },
  { key: "duplicate", label: "ซ้ำ", toneClass: "text-blue-600" },
  { key: "failed", label: "ล้มเหลว", toneClass: "text-red-600" },
];

export function BatchSummaryCard({ summary }: { summary: UploadBatchSummary }) {
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="สรุปผลอัปโหลด">
      {CARDS.map((c) => (
        <div key={c.key} className="rounded-lg border border-slate-200 bg-white p-3 text-center shadow-sm">
          <div className={`text-xl font-extrabold tabular-nums ${c.toneClass}`}>{summary[c.key]}</div>
          <div className="mt-0.5 text-[0.66rem] font-semibold text-slate-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
