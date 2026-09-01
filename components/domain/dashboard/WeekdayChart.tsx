import type { WeekdayPoint } from "@/lib/dashboard/types";
import { formatCount, formatTHBCompact } from "@/lib/tiktok/format";

// Sales by Weekday, scoped to the selected period (0052 — was all-time in
// 0044 §1a; owner asked for it to follow the วันนี้/7 วัน/เดือนนี้ toggle like
// every other chart). Server component, 7 vertical bars. Bar height is always
// driven by `orders` (present for every role, per design §6) — `revenue` is
// folded into the tooltip only when non-null, so this one chart works
// unchanged for both owner and staff without a mode toggle.
const DISPLAY_DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun; RPC returns dow 0=Sun..6=Sat

export function WeekdayChart({ points }: { points: WeekdayPoint[] }) {
  const ordered = DISPLAY_DOW_ORDER.map((dow) => points.find((p) => p.dow === dow)).filter(
    (p): p is WeekdayPoint => p !== undefined
  );

  const W = 1000;
  const H = 220;
  const padLeft = 52;
  const padRight = 16;
  const padTop = 20;
  const padBottom = 28;
  const n = Math.max(ordered.length, 1);
  const max = Math.max(...ordered.map((p) => p.orders), 0) * 1.14 || 1;
  const gap = (W - padLeft - padRight) / n;
  const barWidth = gap * 0.55;
  const plotH = H - padTop - padBottom;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold text-zinc-900">รูปแบบรายวันในสัปดาห์</h3>
      <p className="text-xs text-zinc-500">ตามช่วงที่เลือกด้านบน</p>

      {ordered.length === 0 ? (
        <p className="mt-6 py-8 text-center text-sm text-zinc-400">ไม่มีข้อมูล</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block w-full overflow-visible" role="img" aria-label="จำนวนออเดอร์ตามวันในสัปดาห์">
          {[0, 0.5, 1].map((f) => {
            const y = padTop + plotH * (1 - f);
            return (
              <g key={f}>
                <line x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="#e2e8f0" strokeWidth={1} />
                <text x={padLeft - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#94a3b8">
                  {formatCount(Math.round(max * f))}
                </text>
              </g>
            );
          })}
          {ordered.map((p, i) => {
            const barH = Math.max((plotH * p.orders) / max, p.orders > 0 ? 1 : 0);
            const x = padLeft + gap * i + (gap - barWidth) / 2;
            const y = H - padBottom - barH;
            return (
              <g key={p.dow}>
                <rect x={x} y={y} width={barWidth} height={barH} rx={4} fill="#a2191d">
                  {/* single template-string child — see DonutChart for why an
                      expression list silently renders an empty <title>. */}
                  <title>{`${p.label} · ${formatCount(p.orders)} ออเดอร์${
                    p.revenue !== null ? ` · ${formatTHBCompact(p.revenue)}` : ""
                  }`}</title>
                </rect>
                <text x={x + barWidth / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#71717a">
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
