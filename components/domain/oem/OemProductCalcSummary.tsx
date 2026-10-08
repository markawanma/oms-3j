"use client";

// OemProductCalcSummary — รายการสินค้า/บริการ (metal='product', migration 0166) ในหน้า admin: การ์ดคิดราคา
// (QuoteJobItemCard) และใบที่บันทึกแล้ว (QuoteDetailClient). แยกจาก OemCalcBreakdown/OemBarCalcSummary เหมือนเงินแท่ง —
// รายการนี้ไม่มีต้นทุนโลหะ/ค่าแรง/ล็อตผลิต จึงไม่ควรโชว์กำแพงบรรทัดศูนย์ของงานผลิต
//
// ไม่มีการคิดเงินที่นี่ — ทุกตัวเลขอ่านตรงจาก calc.breakdown.product / calc.breakdown / calc.warnings ที่ analytics.oem_price_calc คืน
// 🔴 ADMIN ONLY: ไฟล์นี้แสดงทุนต่อชิ้น + margin + เหตุผลราคา + ราคาแคตตาล็อก ⇒ หน้าพิมพ์ (PrintQuoteClient) ห้าม import
// (ด่านจริงของ "ไม่หลุดถึงลูกค้า" คือ PrintableQuote ที่ไม่มี field พวกนี้ — lib/oem/printableQuote.ts)

import { AlertTriangle } from "lucide-react";
import type { OemPriceCalcResult } from "@/lib/oem/types";
import { fmtPct } from "@/lib/oem/display";
import { formatTHB } from "@/lib/format";

export function OemProductCalcSummary({ calc }: { calc: OemPriceCalcResult }) {
  const p = calc.breakdown.product;
  if (!p) {
    // Defensive only — calc ของ metal='product' มี breakdown.product เสมอตามสัญญา 0166
    return null;
  }

  const costMissing = calc.missing.find((m) => m.rateKey === "catalog_unit_cost");

  return (
    <div className="space-y-2.5">
      {!calc.isComplete ? (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700">
          <p className="flex items-start gap-1.5 font-semibold">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ออกใบเสนอราคาไม่ได้ — {costMissing ? "สินค้านี้ยังไม่มีต้นทุนในแคตตาล็อก" : "ข้อมูลรายการนี้ยังไม่ครบ"}
          </p>
          {calc.missing.map((m, i) => (
            <p key={i} className="mt-1">
              {m.questionTh}
            </p>
          ))}
          <p className="mt-1 text-red-600">บันทึกเป็นร่างได้ตามปกติ</p>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
          <p className="text-xs text-zinc-500">
            {p.sku ? (
              <>
                <span className="font-semibold text-zinc-700">{p.sku}</span> · {p.name}
              </>
            ) : (
              <>
                {p.name} <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600">ไม่มี SKU</span>
              </>
            )}
          </p>

          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="flex items-center gap-1.5 text-xs text-zinc-500">
              ราคาต่อชิ้น
              {p.belowCatalog === true && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">ต่ำกว่าแคตตาล็อก</span>
              )}
            </span>
            <span className="text-xl font-bold tabular-nums text-zinc-900">{formatTHB(p.unitPriceThb)}</span>
          </div>

          <dl className="mt-1.5 space-y-0.5 border-t border-dashed border-zinc-200 pt-1.5 text-xs text-zinc-600">
            {p.catalogListPrice != null && (
              <div className="flex justify-between">
                <dt>ราคาแคตตาล็อก (อ้างอิง)</dt>
                <dd className="tabular-nums">{formatTHB(p.catalogListPrice)}</dd>
              </div>
            )}
            {p.priceReason && (
              <div className="flex justify-between gap-3">
                <dt className="shrink-0">เหตุผลราคา</dt>
                <dd className="text-right">{p.priceReason}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>ทุนต่อชิ้น ({p.costSource === "catalog" ? "จากแคตตาล็อก · ค่าประมาณ" : "กรอกเอง"})</dt>
              <dd className="tabular-nums">{formatTHB(calc.breakdown.costPiece)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>margin รายการนี้</dt>
              <dd className="tabular-nums">{fmtPct(calc.breakdown.marginActualPct)}</dd>
            </div>
          </dl>

          <div className="mt-1.5 flex items-baseline justify-between border-t border-zinc-200 pt-1.5">
            <span className="text-sm font-semibold text-zinc-700">ยอดรวม</span>
            <span className="text-2xl font-bold tabular-nums text-primary-700">
              {calc.breakdown.quoteTotal != null ? formatTHB(calc.breakdown.quoteTotal) : "—"}
            </span>
          </div>

          <p className="mt-1 text-[11px] text-zinc-400">
            รายการสินค้าไม่มีด่านทุนรายชิ้น — ด่านที่ยังใช้: กำไรรวมทั้งใบติดลบ = ออกใบไม่ได้ · ส่วนลดที่ทำให้ margin ต่ำกว่าเกณฑ์ · ทุน/เหตุผล/ราคาแคตตาล็อกเห็นเฉพาะในระบบ ไม่ขึ้นหน้าพิมพ์
          </p>
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
