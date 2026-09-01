"use client";

import { useState } from "react";
import type { SalesPeriodPoint, SalesGranularity } from "@/lib/tiktok/types";
import { formatAbbrev, formatCount, formatMonthShort, formatTHBCompact } from "@/lib/tiktok/format";

type Mode = "sales" | "orders" | "aov";

const MODE_LABEL: Record<Mode, string> = { sales: "ยอดขาย", orders: "ออเดอร์", aov: "AOV" };

// Hand-rolled SVG bar chart (design §4: "เลี่ยง recharts +100KB เพื่อ 2
// กราฟ"). Ports the mockup's drawSTrend() to declarative React — native
// <title> gives a hover tooltip for free instead of the mockup's custom
// mouse-tracked tooltip div, trading a bit of visual polish for far less
// code/state to maintain.
export function SalesTrendChart({ points, granularity }: { points: SalesPeriodPoint[]; granularity: SalesGranularity }) {
  const [mode, setMode] = useState<Mode>("sales");

  const W = 1000;
  const H = 260;
  const padLeft = 52;
  const padRight = 16;
  const padTop = 20;
  const padBottom = 30;
  const n = Math.max(points.length, 1);
  const values = points.map((p) => (mode === "orders" ? p.orders : mode === "aov" ? p.aov : p.sales));
  const max = Math.max(...values, 0) * 1.14 || 1;
  const gap = (W - padLeft - padRight) / n;
  const barWidth = gap * 0.6;
  const plotH = H - padTop - padBottom;

  const formatVal = (v: number) => (mode === "orders" ? formatCount(v) : formatTHBCompact(v));
  const formatTick = (v: number) => (mode === "orders" ? formatCount(Math.round(v)) : `฿${formatAbbrev(v)}`);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">ยอดขายรายเดือน</h3>
          <p className="text-xs text-zinc-500">สลับหน่วยที่ปุ่มขวา</p>
        </div>
        <div className="ml-auto inline-flex overflow-hidden rounded-full border border-zinc-300" role="tablist" aria-label="เลือกหน่วยกราฟ">
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-9 px-3 text-xs font-semibold ${mode === m ? "bg-primary-600 text-white" : "bg-white text-zinc-600"}`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {points.length === 0 ? (
        <p className="mt-6 py-8 text-center text-sm text-zinc-400">ไม่มีข้อมูลในช่วงที่เลือก</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block w-full overflow-visible" role="img" aria-label={`กราฟ${MODE_LABEL[mode]}รายช่วง`}>
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
            const v = mode === "orders" ? p.orders : mode === "aov" ? p.aov : p.sales;
            const barH = Math.max((plotH * v) / max, v > 0 ? 1 : 0);
            const x = padLeft + gap * i + (gap - barWidth) / 2;
            const y = H - padBottom - barH;
            return (
              <g key={p.period}>
                <rect x={x} y={y} width={barWidth} height={barH} rx={4} fill="#4f46e5">
                  {/* single template-string child — see DonutChart for why an
                      expression list renders an empty <title>. */}
                  <title>{`${formatMonthShort(p.period)} · ${formatVal(v)}${
                    mode !== "orders" ? ` · ${formatCount(p.orders)} ออเดอร์` : ` · AOV ${formatTHBCompact(p.aov)}`
                  }`}</title>
                </rect>
                <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill="#475569">
                  {formatVal(v)}
                </text>
                <text x={x + barWidth / 2} y={H - 10} textAnchor="middle" fontSize={10} fill="#94a3b8">
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
