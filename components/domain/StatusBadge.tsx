import { AlertTriangle } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { STATUS_LABEL_TH, type OrderStatus } from "@/lib/types";

// Status -> color per ux-ui design summary:
// new=blue confirmed=cyan to_ship=amber shipped=indigo completed=green
// oversold_hold=red+icon cancelled=slate
const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  new: "blue",
  confirmed: "cyan",
  to_ship: "amber",
  shipped: "indigo",
  completed: "green",
  oversold_hold: "red",
  cancelled: "slate",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      {status === "oversold_hold" && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
      {STATUS_LABEL_TH[status]}
    </Badge>
  );
}
