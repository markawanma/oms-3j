import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

// StatCard — a single KPI / summary tile for the dashboard. Server-compatible
// (no client JS). When `href` is set the whole card becomes a link with a
// hover affordance. `tone` colours the value: brand (primary-700) for hero
// numbers, warning/danger for attention states, neutral otherwise.

export type StatCardTone = "brand" | "neutral" | "warning" | "danger";

const VALUE_TONE: Record<StatCardTone, string> = {
  brand: "text-primary-700",
  neutral: "text-zinc-900",
  warning: "text-amber-600",
  danger: "text-red-600",
};

const CARD_TONE: Record<StatCardTone, string> = {
  brand: "border-zinc-200",
  neutral: "border-zinc-200",
  warning: "border-amber-300 bg-amber-50/50",
  danger: "border-red-300 bg-red-50/50",
};

export function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
  href,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: StatCardTone;
  href?: string;
  icon?: LucideIcon;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-xs font-medium leading-tight text-zinc-500">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className="min-w-0">{label}</span>
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${VALUE_TONE[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-400">{sub}</div>}
    </>
  );

  const base = `block rounded-lg border bg-white p-3.5 shadow-sm ${CARD_TONE[tone]}`;

  if (href) {
    return (
      <Link href={href} className={`${base} transition-colors hover:border-primary-300`}>
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}
