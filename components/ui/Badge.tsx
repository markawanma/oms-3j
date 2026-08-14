import type { ReactNode } from "react";

export type BadgeTone = "blue" | "cyan" | "amber" | "indigo" | "green" | "red" | "slate" | "black" | "orange";

const TONE_CLASSES: Record<BadgeTone, string> = {
  blue: "bg-blue-100 text-blue-800",
  cyan: "bg-cyan-100 text-cyan-800",
  amber: "bg-amber-100 text-amber-800",
  indigo: "bg-indigo-100 text-indigo-800",
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-800",
  slate: "bg-zinc-100 text-zinc-700",
  black: "bg-zinc-900 text-white",
  orange: "bg-orange-100 text-orange-800",
};

export function Badge({
  tone = "slate",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
