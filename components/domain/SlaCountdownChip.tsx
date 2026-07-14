// components/domain/SlaCountdownChip.tsx
//
// DECISION #1 (Tech Lead, locked): near-SLA countdown is a temporarily
// disabled feature. The `orders` table has no `ship_by_at` column yet — it
// depends on a per-marketplace field that only becomes available once a
// real connector (Shopee/TikTok/Lazada) is wired up and pulling that data
// (see docs/phase1-design.md §5, R1/R2). Building the chip now, unbound, so
// the Order Detail layout doesn't need to change again later.
//
// TO ENABLE: once `orders.ship_by_at timestamptz` exists and is populated by
// a real connector, delete the `hidden` early-return below and pass a real
// ISO timestamp as `shipByAt`. Everything else (color thresholds, aria-live
// countdown text) is already implemented.

import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

export function SlaCountdownChip({ shipByAt }: { shipByAt: string | null }) {
  // Feature intentionally hidden until ship_by_at is a real, populated
  // column — see decision note above. Do not remove this guard without
  // also wiring up the data source.
  if (!shipByAt) return null;

  const msLeft = new Date(shipByAt).getTime() - Date.now();
  const hoursLeft = msLeft / (1000 * 60 * 60);
  const tone = hoursLeft <= 0 ? "red" : hoursLeft <= 6 ? "amber" : "slate";

  return (
    <Badge tone={tone as any}>
      <Clock className="h-3 w-3" aria-hidden="true" />
      <span aria-live="polite">
        {hoursLeft <= 0 ? "เกินกำหนดส่ง" : `เหลือ ${Math.max(0, Math.round(hoursLeft))} ชม.`}
      </span>
    </Badge>
  );
}
