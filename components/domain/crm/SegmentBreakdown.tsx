import Link from "next/link";
import { RFM_SEGMENTS, SEGMENT_LABEL_TH } from "@/lib/crm/segments";
import type { RfmSegment } from "@/lib/crm/segments";
import { formatCount } from "@/lib/tiktok/format";
import { SegmentBadge } from "./SegmentBadge";

const BAR_TONE: Record<RfmSegment, string> = {
  champion: "bg-amber-500",
  loyal: "bg-green-500",
  new: "bg-blue-500",
  standard: "bg-zinc-400",
  at_risk: "bg-red-500",
  no_orders: "bg-zinc-300",
};

/** Simple horizontal-bar list, not a chart library (over-engineering guard
 * per handoff: "ไม่ทำ chart library หนักๆ ถ้า Tailwind/SVG ง่ายๆ พอ") — each
 * row links to /crm/customers pre-filtered to that segment. */
export function SegmentBreakdown({
  counts,
  rangeNote,
}: {
  counts: Record<RfmSegment, number>;
  /** Optional clarifying note rendered under the fixed-threshold note —
   * /crm/overview uses this to explain that segment counts here are scoped
   * to customers active in the selected date range, while each customer's
   * segment VALUE is still their current (as-of-today) RFM state. */
  rangeNote?: string;
}) {
  const total = RFM_SEGMENTS.reduce((sum, s) => sum + counts[s], 0);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h3 className="text-sm font-bold text-zinc-800">แบ่งกลุ่มลูกค้า (RFM)</h3>
      <ul className="mt-3 flex flex-col gap-2.5">
        {RFM_SEGMENTS.map((segment) => {
          const count = counts[segment];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <li key={segment}>
              <Link
                href={`/crm/customers?segment=${segment}`}
                className="flex flex-col gap-1 rounded-md p-1 hover:bg-zinc-50"
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <SegmentBadge segment={segment} />
                  <span className="tabular-nums text-zinc-600">
                    {formatCount(count)} คน · {pct}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
                  <div className={`h-full rounded-full ${BAR_TONE[segment]}`} style={{ width: `${pct}%` }} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[0.68rem] text-zinc-400">
        เกณฑ์คงที่ (ไม่ใช่สัดส่วนสัมพัทธ์) — {SEGMENT_LABEL_TH.at_risk}: เงียบเกิน 90 วัน
      </p>
      {rangeNote && <p className="mt-1 text-[0.68rem] text-zinc-400">{rangeNote}</p>}
    </div>
  );
}
