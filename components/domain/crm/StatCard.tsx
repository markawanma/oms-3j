/** Plain KPI stat card — CRM totals have no "vs yesterday" trend to show
 * (unlike TikTok's KpiCard/DashboardKpi), so this is a deliberately simpler
 * sibling rather than forcing CRM data into TikTok's trend-shaped type.
 * Markup mirrors SalesKpiRow's inline card style
 * (components/domain/tiktok/SalesKpiRow.tsx) for visual consistency. */
export function StatCard({
  label,
  value,
  sub,
  hero = false,
}: {
  label: string;
  value: string;
  sub?: string;
  hero?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="text-xs text-zinc-500">{label}</div>
      <div
        className={`mt-1 text-xl font-extrabold tracking-tight tabular-nums ${
          hero ? "text-primary-700" : "text-zinc-900"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[0.66rem] text-zinc-400">{sub}</div>}
    </div>
  );
}
