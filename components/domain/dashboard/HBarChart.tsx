import type { HBarRow } from "@/lib/dashboard/types";

// Generic horizontal-bar list — used for both Top SKU and AOV-by-channel
// (design §4). Server component (no interactivity needed): plain divs sized
// by width% rather than hand-rolled SVG, since labels are real DOM text
// (better truncation/wrapping on mobile than SVG <text>) — still "no chart
// lib", just not every chart in this module needs to be SVG.
export function HBarChart({
  title,
  subtitle,
  rows,
  color = "#a2191d", // primary-600 (brand red)
  emptyMessage = "ไม่มีข้อมูล",
}: {
  title: string;
  subtitle?: string;
  rows: HBarRow[];
  color?: string;
  emptyMessage?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 0);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold text-zinc-900">{title}</h3>
      {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}

      {rows.length === 0 ? (
        <p className="mt-6 py-8 text-center text-sm text-zinc-400">{emptyMessage}</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {rows.map((r, i) => {
            const pct = max > 0 ? Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0) : 0;
            return (
              <li key={`${r.label}-${i}`} title={`${r.label} · ${r.displayValue}${r.sub ? ` · ${r.sub}` : ""}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-medium text-zinc-700">
                    {i + 1}. {r.label}
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-900">{r.displayValue}</span>
                </div>
                <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
                {r.sub && <p className="mt-0.5 truncate text-[11px] text-zinc-400">{r.sub}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
