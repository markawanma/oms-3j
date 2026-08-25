"use client";

// OemBarCalcSummary — silver999 (เงินแท่ง 99.99%) mode's calc display. A
// deliberately SEPARATE component from OemCalcBreakdown: bar items have none
// of production's cost/labor/batch/reject breakdown (metal.perPiece=0,
// labor/batch=0, no floors that gate anything — see 0078 D3/D4), so reusing
// OemCalcBreakdown would render a confusing wall of zeroed-out/"ยังไม่ได้กรอก"
// lines that don't apply to a fixed-price bar. Shared by QuoteJobItemCard
// (live composer) and QuoteDetailClient (saved quote) so the two never
// drift — same pattern OemCalcBreakdown itself uses.
//
// Zero pricing arithmetic here — every number is read straight off
// calc.breakdown.bar / calc.missing, exactly as analytics.oem_price_calc
// (0078) returned it. NEVER render kilo_buy/buy_per_baht/marginPctEmbedded
// as anything other than the report-only footnote below (never a number a
// customer could see — this component is admin-only, same auth gate as
// OemCalcBreakdown, but the print page (PrintQuoteClient) must NEVER import
// this file — see that file's own header for why).

import { AlertTriangle } from "lucide-react";
import type { OemPriceCalcResult } from "@/lib/oem/types";
import { fmtPct } from "@/lib/oem/display";
import { formatBangkokTimeOnly, formatTHB } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";

export function OemBarCalcSummary({ calc }: { calc: OemPriceCalcResult }) {
  const bar = calc.breakdown.bar;
  const priceMissing = calc.missing.find((m) => m.rateKey === "silver_bar_price");

  if (!bar) {
    // Defensive only — a calc for metal='silver999' always carries
    // breakdown.bar per the 0078 contract. Should never actually render.
    return null;
  }

  return (
    <div className="space-y-2.5">
      {priceMissing ? (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700">
          <p className="flex items-start gap-1.5 font-semibold">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ออกใบเสนอราคาไม่ได้ — ยังไม่มีราคาเงินแท่งของวันนี้
          </p>
          <p className="mt-1">{priceMissing.questionTh}</p>
          <p className="mt-1 text-red-600">บันทึกเป็นร่างได้ตามปกติ — จะออกใบเสนอราคาได้ทันทีที่ราคาวันนี้เข้าระบบ</p>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-zinc-500">ราคาเงินแท่ง/แท่ง</span>
            <span className="text-xl font-bold tabular-nums text-zinc-900">
              {bar.barPricePerPiece != null ? formatTHB(bar.barPricePerPiece) : "—"}
            </span>
          </div>

          {(bar.engraveImageThb || bar.engraveTextThb) && (
            <dl className="mt-1.5 space-y-0.5 border-t border-dashed border-zinc-200 pt-1.5 text-xs text-zinc-600">
              {!!bar.engraveImageThb && (
                <div className="flex justify-between">
                  <dt>ค่ายิงเลเซอร์รูปภาพ</dt>
                  <dd className="tabular-nums">{formatTHB(bar.engraveImageThb)}/ชิ้น</dd>
                </div>
              )}
              {!!bar.engraveTextThb && (
                <div className="flex justify-between">
                  <dt>ค่ายิงเลเซอร์ตัวอักษร</dt>
                  <dd className="tabular-nums">{formatTHB(bar.engraveTextThb)}/ชิ้น</dd>
                </div>
              )}
            </dl>
          )}

          <div className="mt-1.5 flex items-baseline justify-between border-t border-zinc-200 pt-1.5">
            <span className="text-sm font-semibold text-zinc-700">ยอดรวม</span>
            <span className="text-2xl font-bold tabular-nums text-primary-700">
              {calc.breakdown.quoteTotal != null ? formatTHB(calc.breakdown.quoteTotal) : "—"}
            </span>
          </div>

          {bar.asOfDate && (
            <p className="mt-2 border-t border-zinc-100 pt-1.5 text-xs text-zinc-500">
              ราคาเงินแท่ง ณ วันที่ {formatThaiDateOnly(bar.asOfDate)}
              {bar.sheetTime
                ? ` เวลา ${bar.sheetTime} น.`
                : bar.capturedAt
                ? ` เวลา ${formatBangkokTimeOnly(bar.capturedAt)} น.`
                : ""}
            </p>
          )}

          {/* report-only, never gates anything — floors.margin.value is null
              for bar items on purpose (see 0078 D3/D4's phantom-note note) */}
          {bar.marginPctEmbedded != null && (
            <p className="mt-1 text-[11px] text-zinc-400">margin แฝงในราคาเว็บ (โดยประมาณ) {fmtPct(bar.marginPctEmbedded)}</p>
          )}
        </div>
      )}

      {calc.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-700">
          {calc.warnings.map((w, i) => (
            <li key={i}>· {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
