import type { SalesSummary } from "@/lib/tiktok/types";
import type { ChannelCode } from "@/lib/types";
import { CHANNEL_LABEL_TH, formatCount, formatTHBCompact } from "@/lib/tiktok/format";

// 5 KPI cards: ยอดขาย/ออเดอร์/AOV (from summary.totals) + up to 2 channel
// cards (aggregated from every point's byChannel, since SalesTotals itself
// carries no channel split). Marketplace-only per SalesScope — no LINE card
// (see design §3), unlike the mockup's LINE OA/TikTok pair.
function aggregateChannels(summary: SalesSummary): { code: ChannelCode; sales: number }[] {
  const totals = new Map<ChannelCode, number>();
  for (const point of summary.points) {
    for (const ch of point.byChannel) {
      totals.set(ch.channelCode, (totals.get(ch.channelCode) ?? 0) + ch.sales);
    }
  }
  return Array.from(totals.entries())
    .map(([code, sales]) => ({ code, sales }))
    .sort((a, b) => b.sales - a.sales);
}

export function SalesKpiRow({ summary }: { summary: SalesSummary }) {
  const { totals } = summary;
  const topChannels = aggregateChannels(summary).slice(0, 2);

  const cards: { label: string; value: string; sub?: string; hero?: boolean }[] = [
    { label: "ยอดขาย", value: formatTHBCompact(totals.sales), sub: `${summary.points.length} เดือน`, hero: true },
    { label: "จำนวนออเดอร์", value: formatCount(totals.orders) },
    { label: "AOV", value: formatTHBCompact(totals.aov), sub: "ต่อออเดอร์" },
    ...topChannels.map((ch) => ({
      label: CHANNEL_LABEL_TH[ch.code] ?? ch.code,
      value: totals.sales > 0 ? `${Math.round((ch.sales / totals.sales) * 100)}%` : "0%",
      sub: formatTHBCompact(ch.sales),
    })),
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5" role="group" aria-label="ตัวชี้วัดยอดขาย">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
          <div className="text-xs text-zinc-500">{c.label}</div>
          <div className={`mt-1 text-xl font-extrabold tracking-tight tabular-nums ${c.hero ? "text-brand" : "text-zinc-900"}`}>
            {c.value}
          </div>
          {c.sub && <div className="mt-0.5 text-[0.66rem] text-zinc-400">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
