// Generic donut chart — used for both Product Mix and New-vs-Returning
// (design §4). Server component: SVG stroke-dasharray ring, no hooks needed.
export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  title,
  subtitle,
  slices,
  formatValue = (v: number) => v.toLocaleString("en-US"),
  emptyMessage = "ไม่มีข้อมูล",
  showValue = false,
}: {
  title: string;
  subtitle?: string;
  slices: DonutSlice[];
  formatValue?: (v: number) => string;
  emptyMessage?: string;
  /** Also show the formatted value in the legend (e.g. "฿252K · 53%"), not
   * just the %. Default false keeps Product Mix / New-Returning unchanged. */
  showValue?: boolean;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const nonZero = slices.filter((s) => s.value > 0);

  const r = 40;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold text-zinc-900">{title}</h3>
      {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}

      {total === 0 || nonZero.length === 0 ? (
        <p className="mt-6 py-8 text-center text-sm text-zinc-400">{emptyMessage}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <svg viewBox="0 0 100 100" className="h-32 w-32 shrink-0 -rotate-90" role="img" aria-label={title}>
            <circle cx={50} cy={50} r={r} fill="none" stroke="#f4f4f5" strokeWidth={16} />
            {nonZero.map((s, i) => {
              const frac = total > 0 ? s.value / total : 0;
              const dash = frac * circumference;
              const seg = (
                <circle
                  key={`${s.label}-${i}`}
                  cx={50}
                  cy={50}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={16}
                  strokeDasharray={`${Math.max(dash - 1, 0)} ${circumference - Math.max(dash - 1, 0)}`}
                  strokeDashoffset={-offset}
                >
                  <title>
                    {s.label} · {formatValue(s.value)} · {Math.round(frac * 100)}%
                  </title>
                </circle>
              );
              offset += dash;
              return seg;
            })}
          </svg>
          <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
            {slices.map((s, i) => (
              <li key={`${s.label}-${i}`} className="flex items-center gap-1.5 text-zinc-600">
                <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
                <span className="min-w-0 truncate">{s.label}</span>
                <span className="ml-auto shrink-0 font-semibold text-zinc-900">
                  {showValue
                    ? `${formatValue(s.value)} · ${total > 0 ? Math.round((s.value / total) * 100) : 0}%`
                    : `${total > 0 ? Math.round((s.value / total) * 100) : 0}%`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
