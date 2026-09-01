"use client";

import { useState } from "react";
import type { TrendPoint } from "@/lib/dashboard/types";
import { formatAbbrev, formatCount, formatPeriodLabel, formatTHBCompact } from "@/lib/tiktok/format";

type Mode = "revenue" | "orders";

const MODE_LABEL: Record<Mode, string> = { revenue: "ยอดขาย", orders: "ออเดอร์" };

// Sales Trend — scoped to whatever [from,to] range the page's date filter is
// currently set to (0054; was a fixed 30-day window pre-0054, see design
// §1a). Ported from components/domain/tiktok/SalesTrendChart.tsx: daily
// x-labels instead of formatMonthShort, per-bar value labels dropped (many
// bars is too dense), and x-axis ticks are sparse (every ~5th day) to avoid
// overlap.
// Staff: revenue/aov come back null from the RPC (money gated in SQL, see
// design §6) — mode is forced to "orders" and the money toggle is hidden
// entirely rather than merely disabled.
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const moneyAvailable = points.some((p) => p.revenue !== null);
  const [modeState, setModeState] = useState<Mode>("revenue");
  const mode: Mode = moneyAvailable ? modeState : "orders";

  const W = 1000;
  const H = 260;
  const padLeft = 52;
  const padRight = 16;
  const padTop = 20;
  const padBottom = 30;
  const n = Math.max(points.length, 1);
  const values = points.map((p) => (mode === "orders" ? p.orders : p.revenue ?? 0));
  const max = Math.max(...values, 0) * 1.14 || 1;
  const gap = (W - padLeft - padRight) / n;
  const barWidth = gap * 0.6;
  const plotH = H - padTop - padBottom;
  // sparse x-tick labels — showing all 30 dates collides; keep first, last
  // and evenly spaced ticks in between (~6 labels total).
  const tickStep = Math.max(Math.ceil(points.length / 6), 1);

  const formatVal = (v: number) => (mode === "orders" ? formatCount(v) : formatTHBCompact(v));
  const formatTick = (v: number) => (mode === "orders" ? formatCount(Math.round(v)) : `฿${formatAbbrev(v)}`);
  const formatDate = (date: string) => formatPeriodLabel(date, "day");

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">ยอดขายรายวัน</h3>
          <p className="text-xs text-zinc-500">ตามช่วงที่เลือก</p>
        </div>
        {moneyAvailable && (
          <div className="ml-auto inline-flex overflow-hidden rounded-full border border-zinc-300" role="tablist" aria-label="เลือกหน่วยกราฟ">
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setModeState(m)}
                className={`min-h-9 px-3 text-xs font-semibold ${mode === m ? "bg-primary-600 text-white" : "bg-white text-zinc-600"}`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        )}
      </div>

      {points.length === 0 ? (
        <p className="mt-6 py-8 text-center text-sm text-zinc-400">ไม่มีข้อมูล</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block w-full overflow-visible" role="img" aria-label={`กราฟ${MODE_LABEL[mode]}รายวัน ตามช่วงที่เลือก`}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const y = padTop + plotH * (1 - f);
            return (
              <g key={f}>
                <line x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="#e2e8f0" strokeWidth={1} />
                <text x={padLeft - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#94a3b8">
                  {formatTick(max * f)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) => {
            const v = mode === "orders" ? p.orders : p.revenue ?? 0;
            const barH = Math.max((plotH * v) / max, v > 0 ? 1 : 0);
            const x = padLeft + gap * i + (gap - barWidth) / 2;
            const y = H - padBottom - barH;
            const showTick = i === 0 || i === points.length - 1 || i % tickStep === 0;
            return (
              <g key={p.date}>
                <rect x={x} y={y} width={barWidth} height={barH} rx={3} fill="#a2191d">
                  {/* single template-string child — see DonutChart for why an
                      expression list silently renders an empty <title>. */}
                  <title>{`${formatDate(p.date)} · ${formatVal(v)}${
                    mode !== "orders" && p.aov !== null ? ` · AOV ${formatTHBCompact(p.aov)}` : ` · ${formatCount(p.orders)} ออเดอร์`
                  }`}</title>
                </rect>
                {showTick && (
                  <text x={x + barWidth / 2} y={H - 10} textAnchor="middle" fontSize={10} fill="#94a3b8">
                    {formatDate(p.date)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
