import type { SalesPeriodPoint } from "@/lib/tiktok/types";
import type { ChannelCode } from "@/lib/types";
import { CHANNEL_COLOR_HEX, CHANNEL_LABEL_TH, formatMonthShort, formatTHBCompact } from "@/lib/tiktok/format";

// Stacked bar chart, one bar per period, segments = each period's byChannel
// breakdown. Ports the mockup's drawSMix() (design §4). Channels shown in
// the legend are only the ones actually present in `points` (LINE/"other"
// segments from the mockup don't exist here — marketplace-only, see
// SalesScopeNote).
export function ChannelMixChart({ points }: { points: SalesPeriodPoint[] }) {
  const W = 1000;
  const H = 200;
  const padLeft = 16;
  const padRight = 16;
  const padTop = 10;
  const padBottom = 26;
  const n = Math.max(points.length, 1);
  const gap = (W - padLeft - padRight) / n;
  const barWidth = gap * 0.62;
  const plotH = H - padTop - padBottom;

  const presentChannels = Array.from(
    new Set(points.flatMap((p) => p.byChannel.map((c) => c.channelCode)))
  ) as ChannelCode[];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold text-zinc-900">สัดส่วนช่องทางแต่ละเดือน</h3>
      <p className="text-xs text-zinc-500">แยกยอดขายตามช่องทางในแต่ละช่วง</p>

      {presentChannels.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-3 text-xs text-zinc-600">
          {presentChannels.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CHANNEL_COLOR_HEX[c] }} />
              {CHANNEL_LABEL_TH[c] ?? c}
            </span>
          ))}
        </div>
      )}

      {points.length === 0 || presentChannels.length === 0 ? (
        <p className="mt-4 py-8 text-center text-sm text-zinc-400">ไม่มีข้อมูลในช่วงที่เลือก</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block w-full overflow-visible" role="img" aria-label="สัดส่วนช่องทางรายช่วง">
          {points.map((p, i) => {
            const x = padLeft + gap * i + (gap - barWidth) / 2;
            const total = p.byChannel.reduce((sum, c) => sum + c.sales, 0);
            let y = padTop;
            return (
              <g key={p.period}>
                {p.byChannel.map((c) => {
                  const frac = total > 0 ? c.sales / total : 0;
                  const segH = plotH * frac;
                  const rectY = y;
                  y += segH;
                  if (segH < 0.5) return null;
                  return (
                    <rect
                      key={c.channelCode}
                      x={x}
                      y={rectY}
                      width={barWidth}
                      height={Math.max(segH - 1.5, 0.5)}
                      rx={2}
                      fill={CHANNEL_COLOR_HEX[c.channelCode] ?? "#94a3b8"}
                    >
                      <title>
                        {formatMonthShort(p.period)} · {CHANNEL_LABEL_TH[c.channelCode] ?? c.channelCode} ·{" "}
                        {Math.round(frac * 100)}% · {formatTHBCompact(c.sales)}
                      </title>
                    </rect>
                  );
                })}
                <text x={x + barWidth / 2} y={H - 9} textAnchor="middle" fontSize={10} fill="#94a3b8">
                  {formatMonthShort(p.period)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
