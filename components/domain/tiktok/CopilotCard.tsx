import {
  AlertTriangle,
  HelpCircle,
  MessageCircle,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { CopilotRecommendation } from "@/lib/tiktok/types";
import { formatThaiDateOnly } from "@/lib/tiktok/format";

// rec.icon is a lucide-react component *name* (string), never a raw emoji
// (design §7 / tech-design §7: "emoji (📊🎯🏷️💰) → lucide"). Add to this map
// as new recommendation types ship; unknown names fall back to HelpCircle
// instead of crashing.
const ICONS: Record<string, LucideIcon> = { MessageCircle, TrendingUp, Sparkles, AlertTriangle };
function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? HelpCircle;
}

// confidence -> badge tone: green/amber/slate reads faster than a raw % for
// a non-data-scientist owner (design §5). isBlocker cards override with the
// mockup's "ก่อนอื่น · blocker" slate badge regardless of confidence.
const CONFIDENCE_LABEL: Record<CopilotRecommendation["confidence"], string> = {
  high: "confidence สูง",
  medium: "confidence กลาง",
  low: "confidence ต่ำ",
};
const CONFIDENCE_TONE: Record<CopilotRecommendation["confidence"], BadgeTone> = {
  high: "green",
  medium: "amber",
  low: "slate",
};

export function CopilotCard({
  rec,
  onApprove,
  onDismiss,
}: {
  rec: CopilotRecommendation;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const Icon = iconFor(rec.icon);
  const decided = rec.status !== "pending";
  const isBlocker = !!rec.isBlocker;

  return (
    <div className={`flex flex-col gap-2.5 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm ${decided ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${isBlocker ? "bg-amber-100" : "bg-primary-100"}`}>
          <Icon className={`h-4 w-4 ${isBlocker ? "text-amber-700" : "text-primary-700"}`} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-bold text-balance text-zinc-900">{rec.title}</p>
          {!decided ? (
            <Badge tone={isBlocker ? "slate" : CONFIDENCE_TONE[rec.confidence]} className="mt-1">
              {isBlocker ? "ก่อนอื่น · blocker" : CONFIDENCE_LABEL[rec.confidence]}
            </Badge>
          ) : (
            <p className="mt-1 text-xs text-zinc-400">
              {rec.status === "approved" ? "อนุมัติเมื่อ " : "ปัดทิ้งเมื่อ "}
              {rec.decidedAt ? formatThaiDateOnly(rec.decidedAt.slice(0, 10)) : "-"}
            </p>
          )}
        </div>
      </div>

      <p className="text-sm leading-relaxed text-zinc-600">{rec.reasonText}</p>

      <div className="flex flex-wrap gap-1.5">
        {rec.reasonMetrics.map((m) => (
          <span key={m.label} className="rounded bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700 tabular-nums">
            {m.label} <span className="text-brand">{m.value}</span>
          </span>
        ))}
      </div>

      {decided ? (
        <div>
          <Badge tone={rec.status === "approved" ? "green" : "slate"}>
            {rec.status === "approved" ? "✓ อนุมัติแล้ว" : "✕ ปัดทิ้งแล้ว"}
          </Badge>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button variant="secondary" size="sm" onClick={() => onDismiss(rec.id)}>
            ปัดทิ้ง
          </Button>
          <Button variant="primary" size="sm" onClick={() => onApprove(rec.id)}>
            {isBlocker ? "รับทราบ" : "อนุมัติ"}
          </Button>
          {!isBlocker && (
            <Button
              variant="secondary"
              size="sm"
              disabled
              title="เร็วๆ นี้"
              className="ml-auto border-dashed"
            >
              Apply · เร็วๆ นี้
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
