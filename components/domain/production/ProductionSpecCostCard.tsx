"use client";

// ProductionSpecCostCard — pure display of a cost_type='spec' production
// line's cost breakdown (analytics.production_cost_calc branch 'spec',
// 0141/0142) + the SKU's spec (น้ำหนัก/ระดับงาน/พลอย/ชุบ) it was computed
// from. Used by ProductionDoneDialog (live preview, ProductionSpecCostCalc
// from production_order_preview) and ProductionOrderDetailClient (locked-in
// snapshot from a done order's ProductionOrderItemRow.costCalc) — SAME
// component, SAME props shape, so a done order's number is proven to render
// exactly like the preview did.
//
// 🔴 Deliberately a NEW component, not a reuse of
// components/domain/oem/OemCalcBreakdown.tsx: that component's prop is
// OemPriceCalcResult, a type that structurally CARRIES price/margin/floor
// fields (only rendering choices hide them) — reusing it here would mean
// "don't render calc.floors", which is exactly the anti-pattern
// oem-quote-invariants #1 warns about ("ต้องประกอบทีละ field ห้าม spread...
// ด่านคือ type boundary ไม่ใช่คอมเมนต์เตือน"). ProductionSpecCostCalc
// (lib/production/types.ts) has NO price/margin/floor fields at all — this
// module has no pricing layer, full stop (มติเจ้าของ 19 ก.ย.: "ไม่คิด Margin
// ไม่ต้องคำนวณ floor").

import { Gem, Package } from "lucide-react";
import type { MakeSpec } from "@/lib/catalog/types";
import type { ProductionSpecCostCalc } from "@/lib/production/types";
import { formatTHB } from "@/lib/format";

export function ProductionSpecCostCard({
  makeSpec,
  silverWeightG,
  silverPurity,
  costCalc,
}: {
  /** null when the side-channel read didn't find a spec (shouldn't happen
   * for a real cost_type='spec' SKU, but the card still renders the cost
   * breakdown without the top spec line if it does). */
  makeSpec: MakeSpec | null;
  silverWeightG: number | null;
  silverPurity: number | null;
  costCalc: ProductionSpecCostCalc;
}) {
  return (
    <div className="mt-2 space-y-2 rounded-md border border-indigo-200 bg-indigo-50/50 p-2.5">
      {/* การ์ดสเปค — น้ำหนัก/ระดับงาน/พลอย/ชุบ (task brief 2c) */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-600">
        <span>น้ำหนัก {silverWeightG != null ? `${silverWeightG} ก.` : "—"}</span>
        <span className="text-zinc-300">·</span>
        <span>ความบริสุทธิ์ {silverPurity != null ? silverPurity : "—"}</span>
        {makeSpec && (
          <>
            <span className="text-zinc-300">·</span>
            <span>{makeSpec.itemKind}</span>
            <span className="text-zinc-300">·</span>
            <span>ระดับงาน {makeSpec.polishTier}</span>
            <span className="text-zinc-300">·</span>
            <span>ชุบ {makeSpec.platingType ?? "ไม่ชุบ"}</span>
            <span className="text-zinc-300">·</span>
            <span className="inline-flex items-center gap-1">
              <Gem className="h-3 w-3 text-zinc-400" aria-hidden="true" />
              {makeSpec.gemTier ? `${makeSpec.gemTier} (${makeSpec.gemCount} เม็ด)` : "ไม่มีพลอย"}
            </span>
          </>
        )}
      </div>

      {/* breakdown ต้นทุน — ประกอบทีละ field จาก costCalc เท่านั้น (ไม่ spread) —
          costCalc เองไม่มี field ราคา/margin เลยสักตัว (ดู type ที่ import) */}
      <dl className="space-y-0.5 text-xs">
        <div className="flex justify-between">
          <dt className="text-zinc-500">เนื้อเงิน</dt>
          <dd className="tabular-nums text-zinc-700">{formatTHB(costCalc.metalPerPiece)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-zinc-500">ค่าแรง</dt>
          <dd className="tabular-nums text-zinc-700">{formatTHB(costCalc.laborPerPiece)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-zinc-500">ค่ารอบ (แฟลสก์/ชุบ ÷ จำนวน)</dt>
          <dd className="tabular-nums text-zinc-700">{formatTHB(costCalc.batchPerPiece)}</dd>
        </div>
        {costCalc.nrePerPiece > 0 && (
          <div className="flex justify-between">
            <dt className="text-zinc-500">ค่าออกแบบ (÷ {costCalc.qty} ชิ้น)</dt>
            <dd className="tabular-nums text-zinc-700">{formatTHB(costCalc.nrePerPiece)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-indigo-200 pt-1 font-semibold">
          <dt className="text-zinc-700">ต้นทุน/ชิ้น</dt>
          <dd className="tabular-nums text-zinc-900">{formatTHB(costCalc.unitCost)}</dd>
        </div>
      </dl>

      {costCalc.batchLines.length > 0 && (
        <div className="space-y-1 border-t border-indigo-100 pt-1.5">
          {costCalc.batchLines.map((l) => (
            <div key={l.key} className="flex items-start gap-1.5 text-xs text-zinc-500">
              <Package className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden="true" />
              <span>
                {l.key === "flask" ? "แฟลสก์" : "รอบชุบ"}: {l.count ?? "?"} รอบ × ความจุ {l.capacity ?? "?"} ชิ้น
                {l.cost != null && ` = ${formatTHB(l.cost)}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {!costCalc.isComplete && (
        <p className="text-xs text-amber-700">
          ข้อมูลต้นทุนยังไม่ครบ ({costCalc.missing.length} รายการ) — ไปกรอกที่ /oem/rates ก่อนสั่งผลิตจริง
        </p>
      )}
    </div>
  );
}
