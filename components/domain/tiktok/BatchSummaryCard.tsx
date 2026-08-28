import type { LabelParseSummary } from "@/lib/labels/types";

// One card per file (design brief §"แสดงผล" — "การ์ดสรุปต่อไฟล์"), all 7
// counters straight off the contract so nothing that DB/parser produces gets
// silently dropped on the floor. `applied` is the only "good news" green
// number — everything else is either neutral info (skippedHasProvince) or
// needs a human (amber/red), never auto-hidden.
const CARDS: { key: keyof Pick<LabelParseSummary, "applied" | "skippedHasProvince" | "conflictCount" | "needsReview" | "orderNotFound" | "undetectedFormat" | "parseFailedPages">; label: string; toneClass: string }[] = [
  { key: "applied", label: "เติมสำเร็จ", toneClass: "text-green-600" },
  { key: "skippedHasProvince", label: "มีจังหวัดอยู่แล้ว", toneClass: "text-zinc-600" },
  { key: "conflictCount", label: "ขัดแย้ง", toneClass: "text-red-600" },
  { key: "needsReview", label: "รอคนตรวจ", toneClass: "text-amber-600" },
  { key: "orderNotFound", label: "หาออเดอร์ไม่เจอ", toneClass: "text-amber-600" },
  { key: "undetectedFormat", label: "รูปแบบไม่รู้จัก", toneClass: "text-zinc-500" },
  { key: "parseFailedPages", label: "อ่านหน้าไม่ได้", toneClass: "text-red-600" },
];

export function BatchSummaryCard({ summary }: { summary: LabelParseSummary }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={`สรุปผลอ่านไฟล์ ${summary.fileName}`}>
      {CARDS.map((c) => (
        <div key={c.key} className="rounded-lg border border-zinc-200 bg-white p-3 text-center shadow-sm">
          <div className={`text-xl font-extrabold tabular-nums ${c.toneClass}`}>{summary[c.key]}</div>
          <div className="mt-0.5 text-[0.66rem] font-semibold text-zinc-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
