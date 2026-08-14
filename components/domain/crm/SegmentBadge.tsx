import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { SEGMENT_LABEL_TH } from "@/lib/crm/segments";
import type { RfmSegment } from "@/lib/crm/segments";

const SEGMENT_TONE: Record<RfmSegment, BadgeTone> = {
  champion: "amber",
  loyal: "green",
  new: "blue",
  standard: "slate",
  at_risk: "red",
  no_orders: "slate",
};

export function SegmentBadge({ segment }: { segment: RfmSegment }) {
  return <Badge tone={SEGMENT_TONE[segment]}>{SEGMENT_LABEL_TH[segment]}</Badge>;
}
