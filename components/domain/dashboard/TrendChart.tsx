"use client";

import { useId, useState } from "react";
import type { TrendPoint, TrendProductRow, TrendSplitRow, TrendSplits } from "@/lib/dashboard/types";
import { formatAbbrev, formatCount, formatPeriodLabel, formatTHBCompact } from "@/lib/tiktok/format";
import {
  BUCKET_COLOR,
  BUCKET_LABEL,
  BUCKET_ORDER,
  FIRST_REPEAT_COLOR,
  FIRST_REPEAT_LABEL,
  FIRST_REPEAT_ORDER,
  RFM_COLOR,
  RFM_ORDER,
  RFM_SPLIT_LABEL,
} from "@/lib/dashboard/split-colors";

type Mode = "revenue" | "orders";
type SplitMode = "none" | "firstRepeat" | "rfm" | "product";

const MODE_LABEL: Record<Mode, string> = { revenue: "ยอดขาย", orders: "ออเดอร์" };
const SPLIT_MODE_LABEL: Record<SplitMode, string> = {
  none: "ไม่แบ่ง",
  firstRepeat: "ซื้อครั้งแรก/ซื้อซ้ำ",
  rfm: "กลุ่มลูกค้า RFM (วันนี้)",
  product: "ประเภทสินค้า",
};

interface SplitAgg {
  /** date -> (key -> value in whatever unit the caller aggregated in). */
  byDate: Map<string, Map<string, number>>;
  /** key -> sum across the whole range (drives the legend's ">0" filter). */
  totals: Map<string, number>;
}

// first_repeat/rfm rows carry BOTH orders and revenue per (date,key) — the
// caller picks which one to sum based on the current ยอดขาย|ออเดอร์ toggle so
// a stack's per-day sum matches that toggle's single-color bar exactly
// (design invariant, backend-proven — see migration 0119 header).
function aggregateSplitRows(rows: TrendSplitRow[], useOrders: boolean): SplitAgg {
  const byDate = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    const v = useOrders ? r.orders : (r.revenue ?? 0);
    if (v <= 0) continue; // a 0-value row would render nothing anyway
    const dayMap = byDate.get(r.date) ?? new Map<string, number>();
    dayMap.set(r.key, (dayMap.get(r.key) ?? 0) + v);
    byDate.set(r.date, dayMap);
    totals.set(r.key, (totals.get(r.key) ?? 0) + v);
  }
  return { byDate, totals };
}

// product rows only ever carry `value` (line-item revenue) — no orders unit,
// since one order can span multiple product buckets (see the disabled
// "ประเภทสินค้า" option below).
function aggregateProductRows(rows: TrendProductRow[]): SplitAgg {
  const byDate = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.value <= 0) continue;
    const dayMap = byDate.get(r.date) ?? new Map<string, number>();
    dayMap.set(r.key, (dayMap.get(r.key) ?? 0) + r.value);
    byDate.set(r.date, dayMap);
    totals.set(r.key, (totals.get(r.key) ?? 0) + r.value);
  }
  return { byDate, totals };
}

// Sales Trend — scoped to whatever [from,to] range the page's date filter is
// currently set to (0054; was a fixed 30-day window pre-0054, see design
// §1a). Ported from components/domain/tiktok/SalesTrendChart.tsx: daily
// x-labels instead of formatMonthShort, per-bar value labels dropped (many
// bars is too dense), and x-axis ticks are sparse (every ~5th day) to avoid
// overlap.
// Staff: revenue/aov come back null from the RPC (money gated in SQL, see
// design §6) — mode is forced to "orders" and the money toggle is hidden
// entirely rather than merely disabled.
//
// 0119 — "แบ่งสีแท่งกราฟยอดขายรายวัน": an optional second dimension (แบ่งสี:
// select) restacks each day's bar by first/repeat order, RFM segment (as of
// today, NOT as of the order date — see splitNote below), or product bucket.
// Local useState, not a URL param — switches instantly like the existing
// ยอดขาย|ออเดอร์ toggle, and resets on navigation same as that toggle.
export function TrendChart({
  points,
  splits,
  coverageNote,
}: {
  points: TrendPoint[];
  splits: TrendSplits;
  coverageNote: string;
}) {
  const patternId = useId();
  const moneyAvailable = points.some((p) => p.revenue !== null);
  const [modeState, setModeState] = useState<Mode>("revenue");
  const mode: Mode = moneyAvailable ? modeState : "orders";

  const [splitModeState, setSplitModeState] = useState<SplitMode>("none");

  const firstRepeatAvailable = splits.firstRepeat.length > 0;
  const rfmAvailable = splits.rfm.length > 0;
  const productAvailable = splits.product.length > 0;
  const anySplitAvailable = firstRepeatAvailable || rfmAvailable || productAvailable;

  // โหมดสินค้าใช้ได้เฉพาะ toggle "ยอดขาย" (ออเดอร์เดียวมีได้หลายประเภทสินค้า,
  // นับเป็นออเดอร์ซ้ำในหลาย bucket ไม่ได้) — สลับ toggle ไปออเดอร์แล้ว "ไม่แบ่ง"
  // ถูกตั้งจริง ๆ (ไม่ใช่แค่ซ่อนตัวเลือกไว้เฉย ๆ) กันไม่ให้สลับกลับมายอดขายแล้ว
  // โผล่โหมดสินค้าเดิมโดยไม่ได้ตั้งใจ.
  function handleModeChange(m: Mode) {
    setModeState(m);
    if (m === "orders" && splitModeState === "product") setSplitModeState("none");
  }

  // เผื่อ data หายไปกลางทาง (เช่น re-render ด้วย props ใหม่) โดยไม่ผ่าน
  // handleModeChange — ตกกลับ "ไม่แบ่ง" ที่จอทันทีแทนที่จะโชว์ <select> ว่างเปล่า.
  const splitAvailable: Record<SplitMode, boolean> = {
    none: true,
    firstRepeat: firstRepeatAvailable,
    rfm: rfmAvailable,
    product: productAvailable && mode === "revenue",
  };
  const splitMode: SplitMode = splitAvailable[splitModeState] ? splitModeState : "none";

  const splitAgg: SplitAgg | null =
    splitMode === "firstRepeat"
      ? aggregateSplitRows(splits.firstRepeat, mode === "orders")
      : splitMode === "rfm"
        ? aggregateSplitRows(splits.rfm, mode === "orders")
        : splitMode === "product"
          ? aggregateProductRows(splits.product)
          : null;

  const splitOrderKeys =
    splitMode === "firstRepeat"
      ? FIRST_REPEAT_ORDER
      : splitMode === "rfm"
        ? RFM_ORDER
        : splitMode === "product"
          ? BUCKET_ORDER
          : [];
  const splitColor =
    splitMode === "firstRepeat" ? FIRST_REPEAT_COLOR : splitMode === "rfm" ? RFM_COLOR : splitMode === "product" ? BUCKET_COLOR : {};
  const splitLabel =
    splitMode === "firstRepeat" ? FIRST_REPEAT_LABEL : splitMode === "rfm" ? RFM_SPLIT_LABEL : splitMode === "product" ? BUCKET_LABEL : {};

  // ลำดับ canonical ก่อนเสมอ แล้วต่อท้ายด้วย key ที่ไม่อยู่ในลิสต์คาดไว้ (ถ้ามี)
  // — กันไม่ให้ segment แปลกหน้าหายไปจากสแตก ซึ่งจะทำให้ Σ ของวันนั้นไม่เท่ากับ
  // ค่าแท่งเดิมอีกต่อไป (invariant ที่ design ยืนยันว่าต้องจริงเสมอ).
  const renderOrderKeys = splitAgg
    ? [...splitOrderKeys, ...Array.from(splitAgg.totals.keys()).filter((k) => !splitOrderKeys.includes(k))]
    : [];

  const W = 1000;
  const H = 260;
  const padLeft = 52;
  const padRight = 16;
  const padTop = 20;
  const padBottom = 30;
  const n = Math.max(points.length, 1);
  const values = points.map((p) => (mode === "orders" ? p.orders : (p.revenue ?? 0)));
  const baseMax = Math.max(...values, 0) * 1.14 || 1;

  // โหมดสินค้า: stack ของสินค้าไม่เท่ายอดขายเสมอไป (มีออเดอร์ที่ไม่มีข้อมูล
  // สินค้า / ยอดขายรวมค่าส่ง-ส่วนลดที่ไม่ใช่ตัวสินค้า) — แกนต้องกว้างพอรับทั้ง
  // ยอด stack และยอดขายจริงของทุกวัน ไม่งั้น ghost bar (สูงเท่ายอดขายจริง) จะ
  // ล้นกรอบ.
  let max = baseMax;
  if (splitMode === "product" && splitAgg) {
    const productSums = points.map((p) => {
      const dayMap = splitAgg.byDate.get(p.date);
      return dayMap ? Array.from(dayMap.values()).reduce((a, b) => a + b, 0) : 0;
    });
    const revenues = points.map((p) => p.revenue ?? 0);
    max = Math.max(...productSums, ...revenues, 0) * 1.14 || 1;
  }

  const gap = (W - padLeft - padRight) / n;
  const barWidth = gap * 0.6;
  const plotH = H - padTop - padBottom;
  // sparse x-tick labels — showing all 30 dates collides; keep first, last
  // and evenly spaced ticks in between (~6 labels total).
  const tickStep = Math.max(Math.ceil(points.length / 6), 1);

  const formatVal = (v: number) => (mode === "orders" ? formatCount(v) : formatTHBCompact(v));
  const formatTick = (v: number) => (mode === "orders" ? formatCount(Math.round(v)) : `฿${formatAbbrev(v)}`);
  const formatDate = (date: string) => formatPeriodLabel(date, "day");

  const displayTitle = splitMode === "product" ? "มูลค่าสินค้ารายวัน" : "ยอดขายรายวัน";
  const displaySubtitle =
    splitMode === "product" ? `ตามประเภทสินค้า · ไม่รวมค่าส่ง/ส่วนลด · ${coverageNote}` : "ตามช่วงที่เลือก";
  const ariaLabel =
    splitMode === "product" ? "กราฟมูลค่าสินค้ารายวัน ตามช่วงที่เลือก" : `กราฟ${MODE_LABEL[mode]}รายวัน ตามช่วงที่เลือก`;

  const legendItems = renderOrderKeys
    .filter((k) => (splitAgg?.totals.get(k) ?? 0) > 0)
    .map((k) => ({ key: k, label: splitLabel[k] ?? k, color: splitColor[k] ?? splitColor.unknown ?? "#a1a1aa" }));

  // หมายเหตุใต้ legend — ข้อความบังคับตาม brief ห้ามแก้ความหมาย.
  const splitNote =
    splitMode === "rfm"
      ? 'สีตามกลุ่ม RFM ที่ลูกค้าเป็น ณ วันนี้ ไม่ใช่ ณ วันที่ซื้อ — แท่งเก่าที่เป็นสี "เสี่ยงหาย" คือลูกค้าที่ซื้อวันนั้นแล้วเงียบไปเกิน 90 วัน · ไม่ระบุ = ออเดอร์ที่ไม่มีข้อมูลลูกค้า (มาสก์)'
      : splitMode === "firstRepeat"
        ? "ซื้อครั้งแรก = ออเดอร์แรกของลูกค้าคนนั้นในระบบ (นับทุกช่องทาง) · ไม่ระบุ = ออเดอร์ที่ไม่มีข้อมูลลูกค้า"
        : null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">{displayTitle}</h3>
          <p className="text-xs text-zinc-500">{displaySubtitle}</p>
        </div>
        {(anySplitAvailable || moneyAvailable) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {anySplitAvailable && (
              <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
                แบ่งสี:
                <select
                  value={splitMode}
                  onChange={(e) => setSplitModeState(e.target.value as SplitMode)}
                  className="min-h-9 rounded-md border border-zinc-300 bg-white px-2 text-xs text-zinc-700"
                >
                  <option value="none">{SPLIT_MODE_LABEL.none}</option>
                  {firstRepeatAvailable && <option value="firstRepeat">{SPLIT_MODE_LABEL.firstRepeat}</option>}
                  {rfmAvailable && <option value="rfm">{SPLIT_MODE_LABEL.rfm}</option>}
                  {productAvailable && (
                    <option
                      value="product"
                      disabled={mode === "orders"}
                      title={mode === "orders" ? "แบ่งตามสินค้าได้เฉพาะยอดขาย — ออเดอร์เดียวมีได้หลายประเภท" : undefined}
                    >
                      {SPLIT_MODE_LABEL.product}
                    </option>
                  )}
                </select>
              </label>
            )}
            {moneyAvailable && (
              <div className="inline-flex overflow-hidden rounded-full border border-zinc-300" role="tablist" aria-label="เลือกหน่วยกราฟ">
                {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => handleModeChange(m)}
                    className={`min-h-9 px-3 text-xs font-semibold ${mode === m ? "bg-primary-600 text-white" : "bg-white text-zinc-600"}`}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {points.length === 0 ? (
        <p className="mt-6 py-8 text-center text-sm text-zinc-400">ไม่มีข้อมูล</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block w-full overflow-visible" role="img" aria-label={ariaLabel}>
            {splitMode !== "none" && (
              // เส้นทแยงบนพื้นเทา ให้แยก "ไม่ระบุ" ออกจากสีทึบอื่นได้แม้มองไม่เห็นสี
              // (deuteranopia/achromatopsia) — ใช้ทั้งใน bar และ legend swatch
              // ด้านล่าง (อ้าง id เดียวกันข้าม <svg> ได้ ตราบใดที่อยู่ document
              // เดียวกัน).
              <defs>
                <pattern id={patternId} width={4} height={4} patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                  <rect width={4} height={4} fill="#a1a1aa" />
                  <line x1={0} y1={0} x2={0} y2={4} stroke="#71717a" strokeWidth={2} />
                </pattern>
              </defs>
            )}
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
              const x = padLeft + gap * i + (gap - barWidth) / 2;
              const showTick = i === 0 || i === points.length - 1 || i % tickStep === 0;

              if (splitMode === "none") {
                const v = mode === "orders" ? p.orders : (p.revenue ?? 0);
                const barH = Math.max((plotH * v) / max, v > 0 ? 1 : 0);
                const y = H - padBottom - barH;
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
              }

              const dayMap = splitAgg?.byDate.get(p.date);
              let bottom = 0;
              const segs = renderOrderKeys.flatMap((key) => {
                const v = dayMap?.get(key) ?? 0;
                if (v <= 0) return [];
                const seg = { key, value: v, bottom };
                bottom += v;
                return [seg];
              });
              const dayTotal = bottom; // == this day's single-color bar value, exactly (customer splits) — see aggregateSplitRows.

              return (
                <g key={p.date}>
                  {segs.map((seg) => {
                    const hPx = Math.max((plotH * seg.value) / max, 1);
                    const yTop = H - padBottom - (plotH * (seg.bottom + seg.value)) / max;
                    const pct = dayTotal > 0 ? Math.round((seg.value / dayTotal) * 100) : 0;
                    const fill = seg.key === "unknown" ? `url(#${patternId})` : (splitColor[seg.key] ?? splitColor.unknown ?? "#a1a1aa");
                    return (
                      // ไม่ใส่ rx ในโหมดแบ่ง (ต่างจากแท่งเดี่ยว "ไม่แบ่ง" ด้านบน)
                      <rect key={seg.key} x={x} y={yTop} width={barWidth} height={hPx} fill={fill}>
                        {/* single template-string child (React 19 gotcha, see above). */}
                        <title>{`${formatDate(p.date)} · ${splitLabel[seg.key] ?? seg.key} · ${formatVal(seg.value)} · ${pct}% ของวัน`}</title>
                      </rect>
                    );
                  })}
                  {splitMode === "product" &&
                    (() => {
                      const revenue = p.revenue ?? 0;
                      const ghostH = Math.max((plotH * revenue) / max, revenue > 0 ? 1 : 0);
                      const ghostY = H - padBottom - ghostH;
                      return (
                        // ghost bar — สูงเท่ายอดขายจริงของวันนั้น วาดหลัง stack เสมอ
                        // (วันที่ไม่มีข้อมูลสินค้าเลยจะเหลือแค่กรอบ ไม่ใช่หายไป).
                        <rect x={x} y={ghostY} width={barWidth} height={ghostH} fill="none" stroke="#d4d4d8" strokeDasharray="3 2">
                          <title>{`${formatDate(p.date)} · มูลค่าสินค้า ${formatTHBCompact(dayTotal)} · ยอดขาย ${formatTHBCompact(
                            revenue
                          )} · ${formatCount(p.orders)} ออเดอร์ (${formatCount(p.ordersWithoutItems)} ไม่มีข้อมูลสินค้า)`}</title>
                        </rect>
                      );
                    })()}
                  {showTick && (
                    <text x={x + barWidth / 2} y={H - 10} textAnchor="middle" fontSize={10} fill="#94a3b8">
                      {formatDate(p.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {splitMode !== "none" && legendItems.length > 0 && (
            <>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {legendItems.map((item) => (
                  <li key={item.key} className="flex items-center gap-1.5 text-zinc-600">
                    {item.key === "unknown" ? (
                      <svg width={10} height={10} aria-hidden="true" className="shrink-0">
                        <rect width={10} height={10} fill={`url(#${patternId})`} />
                      </svg>
                    ) : (
                      <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
                    )}
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
              {splitNote && <p className="mt-1.5 text-[11px] leading-snug text-zinc-400">{splitNote}</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
