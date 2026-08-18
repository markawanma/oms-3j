import type { ReactNode } from "react";
import { SegmentBadge } from "./SegmentBadge";

// Collapsible legend explaining the fixed RFM thresholds behind each segment
// badge — sits right under SegmentBreakdown on /crm/overview. Default-closed
// <details> (no client JS/hooks needed) so it doesn't compete for attention
// with the numbers above; staff who don't already know the thresholds by
// heart can expand it on demand. champion_high isn't a RfmSegment value (see
// lib/crm/segments.ts's ValueTier doc comment) so that row reuses
// SegmentBadge segment="champion" plus a small "⭐ ยอดเยอะ" qualifier instead
// of inventing a 7th badge tone.
const LEGEND_ROWS: {
  key: string;
  badge: ReactNode;
  criteria: string;
}[] = [
  {
    key: "champion_high",
    badge: (
      <span className="inline-flex items-center gap-1">
        <SegmentBadge segment="champion" />
        <span className="text-[0.68rem] font-semibold text-amber-600">⭐ ยอดเยอะ</span>
      </span>
    ),
    criteria: "ซื้อ <30 วัน · ≥4 ออเดอร์ · ยอดสะสม >฿5,000",
  },
  {
    key: "champion",
    badge: <SegmentBadge segment="champion" />,
    criteria: "ซื้อ <30 วัน · ≥4 ออเดอร์ · ยอดสะสม >฿1,500",
  },
  {
    key: "loyal",
    badge: <SegmentBadge segment="loyal" />,
    criteria: "ซื้อซ้ำ ≥2 ออเดอร์ ใน 90 วัน",
  },
  {
    key: "new",
    badge: <SegmentBadge segment="new" />,
    criteria: "ซื้อครั้งแรก ใน 30 วัน",
  },
  {
    key: "standard",
    badge: <SegmentBadge segment="standard" />,
    criteria: "ที่เหลือ (ความถี่/ยอดน้อย)",
  },
  {
    key: "at_risk",
    badge: <SegmentBadge segment="at_risk" />,
    criteria: "เงียบเกิน 90 วัน",
  },
  {
    key: "no_orders",
    badge: <SegmentBadge segment="no_orders" />,
    criteria: "มีชื่อในระบบ ยังไม่เคยซื้อ",
  },
];

export function SegmentLegend() {
  return (
    <details className="group rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 shadow-sm">
      <summary className="cursor-pointer text-xs font-semibold text-zinc-600 select-none group-open:mb-2.5 hover:text-primary-700">
        เกณฑ์แต่ละกลุ่มคืออะไร?
      </summary>
      <table className="w-full text-left text-[0.68rem]">
        <tbody>
          {LEGEND_ROWS.map((row) => (
            <tr key={row.key} className="border-b border-zinc-100 last:border-0">
              <td className="py-1.5 pr-3 align-top whitespace-nowrap">{row.badge}</td>
              <td className="py-1.5 align-top text-zinc-500">{row.criteria}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
