"use client";

// QuoteResultPanel — the right-hand (sticky on desktop) column of /oem/quote
// (T5v2): whole-quote summary across every line item + discount preview +
// the two save actions. Per-item cost breakdown lives on each
// QuoteJobItemCard instead (left column) — this panel is deliberately the
// AGGREGATE view. See lib/oem/quoteForm.ts's header comment for why
// aggregateQuotePreview() summing already-computed numbers is not a second
// pricing formula.

import { AlertTriangle, Loader2 } from "lucide-react";
import type { OemBarSize, OemSettingData } from "@/lib/oem/types";
import { OEM_BAR_SIZE_LABEL_TH } from "@/lib/oem/types";
import {
  OEM_BAR_OVERRIDE_MAX_DAYS,
  addDaysIso,
  aggregateQuotePreview,
  bangkokToday,
  barValidUntilIssue,
  OEM_QTY_FLOOR_NOTE_TH,
  calcBelowQtyFloors,
  jobHasBarOverride,
} from "@/lib/oem/quoteForm";
import type { JobForm } from "@/lib/oem/quoteForm";
import type { OemPriceCalcResult } from "@/lib/oem/types";
import { fmtPct, stripInvisibleText } from "@/lib/oem/display";
import { OEM_MANUAL_COST_NOTE_TH, manualCostNoteReason } from "@/lib/oem/productItem";
import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/Button";

/** "ประเภทชิ้นงาน × N ชิ้น" for production, "เงินแท่ง ขนาด X × N แท่ง" for
 * silver999 — QuoteJobItemCard's summaryLabel uses the same split, kept here
 * as its own small helper since this panel's line is a shorter, single-line
 * variant (no SKU prefix). */
function lineItemLabel(job: JobForm): string {
  if (job.metal === "silver999") {
    const sizeLabel = job.barSize ? OEM_BAR_SIZE_LABEL_TH[job.barSize as OemBarSize] : "ยังไม่ระบุขนาด";
    return `เงินแท่ง ${sizeLabel} × ${job.qty || "0"} แท่ง`;
  }
  if (job.metal === "product") {
    return `${job.skuSnapshot || job.productName.trim() || "สินค้า/บริการ"} × ${job.qty || "0"}`;
  }
  return `${job.itemKind || "—"} × ${job.qty || "0"}`;
}

export interface QuoteResultItem {
  key: string;
  job: JobForm;
  calc: OemPriceCalcResult | null;
  calcLoading: boolean;
  calcError: string | null;
}

export function QuoteResultPanel({
  items,
  setting,
  allInputsValid,
  discountThb,
  onDiscountThbChange,
  discountReason,
  onDiscountReasonChange,
  approvalNote,
  onApprovalNoteChange,
  barValidUntil,
  onBarValidUntilChange,
  onSaveDraft,
  onIssueQuote,
  savingDraft,
  savingQuote,
  saveError,
}: {
  items: QuoteResultItem[];
  setting: OemSettingData;
  allInputsValid: boolean;
  discountThb: string;
  onDiscountThbChange: (v: string) => void;
  discountReason: string;
  onDiscountReasonChange: (v: string) => void;
  approvalNote: string;
  onApprovalNoteChange: (v: string) => void;
  /** 0163: วันยืนราคา (YYYY-MM-DD, "" = ยังไม่เลือก) — ใช้เมื่อมีรายการราคาพิเศษเท่านั้น */
  barValidUntil: string;
  onBarValidUntilChange: (v: string) => void;
  onSaveDraft: () => void;
  onIssueQuote: () => void;
  savingDraft: boolean;
  savingQuote: boolean;
  saveError: string | null;
}) {
  const anyLoading = items.some((i) => i.calcLoading);
  const anyError = items.some((i) => i.calcError);
  const anyCalc = items.some((i) => i.calc);

  const allComplete = items.length > 0 && items.every((i) => i.calc?.isComplete);
  const anyHardBlocked = items.some((i) => i.calc?.floors.margin.state === "hard_floor_breach");
  const anyNeedsNoteFromItem = items.some((i) => i.calc?.floors.margin.state === "needs_approval_note");
  // 0168: qty (MOQ) / metal_weight (ล็อตโลหะ) ไม่ใช่ด่านแข็งอีกต่อไป — ต่ำกว่าขั้นต่ำ = ออกใบได้เมื่อมีเหตุผล (qtyFloorShortfall ข้างล่าง)
  // เหลือเฉพาะ jobValue ที่ปุ่มยังปิดตามเดิม · ป้ายแดงของ floor ยังแสดงที่การ์ดรายการ (เป็นคำเตือน)
  const allFloorsPass = items.every((i) => i.calc && i.calc.floors.jobValue.pass === true);
  const qtyFloorShortfall = items.some((i) => calcBelowQtyFloors(i.calc));

  const discountNum = Number(discountThb) || 0;
  const preview = aggregateQuotePreview(
    items.map((i) => ({ calc: i.calc, metal: i.job.metal, qty: Number(i.job.qty) || 0 })),
    discountNum
  );

  // hard floor: unconditional, same as oem_quote_save's aggregate hard-floor
  // check (0078 D4 §"hard floor aggregate ... ไม่แก้" — it's the last line of
  // defense, deliberately with no exceptions).
  const discountBelowHardFloor = preview.marginAfterDiscountPct != null && preview.marginAfterDiscountPct < setting.marginHardFloorPct;
  // floor (needs-a-reason tier): MUST require discountNum > 0, mirroring
  // oem_quote_save's `p_discount_thb > 0 and v_margin_after_discount <
  // margin_floor_pct` clause (0078 D4). Without this guard, a เงินแท่ง-only
  // quote (embedded margin ~19%, always < the 20% default floor) would show
  // "ต้องระบุเหตุผล" and block the issue button even with ZERO discount —
  // the exact phantom-approval-note bug D4 exists to prevent, just moved to
  // this preview instead of the DB. See design-oem-bar-quote.md D4 test (a):
  // "ใบแท่งล้วน ไม่ลด → quoted ผ่าน โดยไม่ถูกบังคับใส่ note".
  //
  // 0163: DB (0079-fix) ยังบังคับ approval_note เมื่อ "มีรายการที่ตรวจ margin รายชิ้นไม่ได้" (เงินแท่ง:
  // floors.margin.value = null) และ margin รวม < floor แม้ไม่ลดราคา — ใบราคาพิเศษที่ margin บางแต่ไม่ต่ำกว่าทุน
  // จึงต้องมีช่องเหตุผลให้กรอก ไม่งั้นกดออกใบแล้วชน error โดยไม่มีช่องให้แก้ (เดิมเงื่อนไขนี้มีแค่ discountNum > 0)
  // 0166 มติ 5: รายการสินค้า margin.value เป็น null โดยออกแบบ (ไม่มีด่านทุนรายชิ้น) ≠ "ตรวจไม่ได้" — ไม่ปลุก note-tier (เหมือน DB)
  const hasUngatedItem = items.some((i) => i.job.metal !== "product" && i.calc?.isComplete && i.calc.floors.margin.value == null);
  const discountBelowFloor =
    (discountNum > 0 || hasUngatedItem) && preview.marginAfterDiscountPct != null && preview.marginAfterDiscountPct < setting.marginFloorPct;
  // 0167 F2: รายการสินค้าที่ทุนกรอกเอง + (ส่วนลด > 0 หรือ กำไรที่กรอกเองกลบรายการขาดทุน) ⇒ ต้องมีเหตุผล (pre-check · DB ตัดสินซ้ำ)
  const manualNote = manualCostNoteReason(
    items.map((i) => {
      const qty = Number(i.job.qty) || 0;
      const b = i.calc?.breakdown;
      return {
        isManualCost: i.job.metal === "product" && b?.product?.costSource === "manual",
        priceTotal: b ? (b.quoteTotal ?? 0) - b.nre.price : 0,
        costTotal: b ? b.costPiece * qty : 0,
      };
    }),
    discountNum
  );
  const needsApprovalNote = anyNeedsNoteFromItem || discountBelowFloor || manualNote !== null || qtyFloorShortfall;

  // 0078: bar prices stand for TODAY only (quote_valid_days=0 server-side —
  // D4), unlike the usual 7/30/45-day window for production metals.
  const hasBarItem = items.some((i) => i.job.metal === "silver999");

  // 0163: ราคาพิเศษ — ใบที่มีรายการแบบนี้ยืนราคาตามวันที่กรอก (ไม่เกิน 30 วัน) ไม่ใช่ "วันนี้เท่านั้น"
  const hasOverride = items.some((i) => jobHasBarOverride(i.job));
  const hasWebBarItem = items.some((i) => i.job.metal === "silver999" && !jobHasBarOverride(i.job));
  const hasProductionItem = items.some((i) => i.job.metal !== "silver999" && i.job.metal !== "product");
  // ต่ำกว่าทุน: ตัดสินที่ DB (floors.barPrice) — ที่นี่แค่ปิดปุ่ม · DB ปฏิเสธซ้ำตอน quoted
  const belowCostIdx = items.findIndex((i) => i.calc?.floors.barPrice?.pass === false);
  const barDateIssue = hasOverride ? barValidUntilIssue(barValidUntil) : null;
  const todayBkk = hasOverride ? bangkokToday() : "";

  // 2+ items sharing the same plating type — production can share a plating
  // batch even though each item was priced independently (0075 design: "no
  // cross-item batching" in the formula on purpose). Surfaced as negotiation
  // room only, never fed back into the price shown.
  const platingCounts = new Map<string, number>();
  for (const it of items) {
    if (it.job.hasPlating && it.job.platingType) {
      platingCounts.set(it.job.platingType, (platingCounts.get(it.job.platingType) ?? 0) + 1);
    }
  }
  const sharedPlating = [...platingCounts.entries()].some(([, n]) => n >= 2);

  const canIssue =
    allInputsValid &&
    allComplete &&
    allFloorsPass &&
    !anyHardBlocked &&
    belowCostIdx < 0 &&
    !barDateIssue &&
    (!needsApprovalNote || stripInvisibleText(approvalNote).trim().length > 0);

  return (
    <div className="space-y-3">
      {!anyCalc && !anyLoading && !anyError && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
          กรอกวัสดุ / ประเภทงาน / น้ำหนัก / จำนวน ทางซ้ายเพื่อดูราคา
        </div>
      )}

      {anyLoading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          กำลังคำนวณ...
        </div>
      )}

      {items
        .filter((i) => i.calcError)
        .map((i, idx) => (
          <div key={i.key} role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            รายการที่ {items.indexOf(i) + 1 || idx + 1}: {i.calcError}
          </div>
        ))}

      {anyCalc && !anyLoading && (
        <>
          <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">สรุปทั้งใบ ({items.length} รายการ)</h3>
            <dl className="mt-2 space-y-1 text-sm">
              {items.map((it, idx) => (
                <div key={it.key} className="flex justify-between gap-2 text-zinc-600">
                  <dt className="truncate">
                    {idx + 1}. {lineItemLabel(it.job)}
                  </dt>
                  <dd className="shrink-0 tabular-nums text-zinc-800">
                    {it.calc?.isComplete && it.calc.breakdown.quoteTotal != null
                      ? formatTHB(it.calc.breakdown.quoteTotal - it.calc.breakdown.nre.price)
                      : "—"}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-2 space-y-1 border-t border-zinc-200 pt-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-600">รวมค่าชิ้นงาน</dt>
                <dd className="tabular-nums text-zinc-800">{preview.isComplete ? formatTHB(preview.piecesSubtotal) : "—"}</dd>
              </div>
              {preview.nreTotal > 0 && (
                <div className="flex justify-between">
                  <dt className="text-zinc-600">NRE รวม</dt>
                  <dd className="tabular-nums text-zinc-800">{formatTHB(preview.nreTotal)}</dd>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <dt className="text-zinc-700">ยอดรวมก่อนส่วนลด</dt>
                <dd className="tabular-nums text-zinc-900">{preview.isComplete ? formatTHB(preview.quoteTotal) : "—"}</dd>
              </div>
            </div>
          </div>

          {hasWebBarItem && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
              ใบนี้มีรายการเงินแท่ง — ราคาเงินแท่งยืนเฉพาะวันนี้เท่านั้น (คนละอายุกับใบเสนอราคาส่วนงานผลิต)
            </p>
          )}

          {hasOverride && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wide text-amber-800">ราคาพิเศษ — ยืนราคาถึง</h3>
              <label className="mt-2 flex flex-col gap-1 text-xs font-semibold text-zinc-600" htmlFor="oem-bar-valid-until">
                วันที่ยืนราคา (ไม่เกิน {OEM_BAR_OVERRIDE_MAX_DAYS} วันนับจากวันนี้)
              </label>
              <input
                id="oem-bar-valid-until"
                type="date"
                min={todayBkk}
                max={addDaysIso(todayBkk, OEM_BAR_OVERRIDE_MAX_DAYS)}
                value={barValidUntil}
                onChange={(e) => onBarValidUntilChange(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
              />
              {barDateIssue && (
                <p role="alert" className="mt-1.5 text-xs font-semibold text-amber-700">
                  {barDateIssue}
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-zinc-500">
                หน้าพิมพ์จะแสดง &quot;ยืนราคาถึง ...&quot; ตามวันนี้ · ราคาเว็บ เหตุผล และทุน เห็นเฉพาะในระบบ
              </p>
              {hasWebBarItem && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ใบนี้มีทั้งราคาพิเศษและแท่งราคาเว็บ — อายุใบ = สั้นที่สุดของทุกรายการ ทั้งใบจะยืนราคาถึงวันนี้เท่านั้น (แยกเป็น 2 ใบถ้าอยากให้ราคาพิเศษยืนตามวันที่กรอก)
                </p>
              )}
              {hasProductionItem && (
                <p className="mt-1.5 text-[11px] text-zinc-500">
                  ใบนี้มีงานผลิตด้วย — อายุใบ = สั้นที่สุดระหว่างวันที่กรอกกับอายุงานผลิต
                </p>
              )}
            </div>
          )}

          {belowCostIdx >= 0 && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md border border-red-300 bg-red-50 p-2.5 text-xs font-semibold text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              รายการที่ {belowCostIdx + 1}: ราคาพิเศษต่ำกว่าทุน — ออกใบเสนอราคาไม่ได้ ไม่มีทางลัด (บันทึกเป็นร่างได้)
            </p>
          )}

          <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">ส่วนลด</h3>
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
                ส่วนลด (บาท)
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="1"
                  value={discountThb}
                  onChange={(e) => onDiscountThbChange(e.target.value)}
                  className="min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
                เหตุผล
                <input
                  type="text"
                  value={discountReason}
                  onChange={(e) => onDiscountReasonChange(e.target.value)}
                  className="min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
                  placeholder="เช่น ลูกค้าสั่งซ้ำ"
                />
              </label>
            </div>

            {preview.isComplete && (
              <div className="mt-2.5 space-y-1 border-t border-zinc-100 pt-2 text-sm">
                <div className="flex justify-between font-semibold">
                  <dt className="text-zinc-700">ยอดสุทธิ</dt>
                  <dd className="text-lg tabular-nums text-primary-700">{formatTHB(preview.grandTotal)}</dd>
                </div>
                <div className="flex justify-between text-xs text-zinc-500">
                  <dt>margin หลังหักส่วนลด (ประมาณ)</dt>
                  <dd className="tabular-nums">{fmtPct(preview.marginAfterDiscountPct)}</dd>
                </div>
              </div>
            )}

            {discountBelowHardFloor && (
              <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-red-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ส่วนลดนี้จะทำให้ margin ต่ำกว่า hard floor ({fmtPct(setting.marginHardFloorPct)}) — ระบบจะปฏิเสธตอนบันทึกจริง ลองลดส่วนลดลง
              </p>
            )}
            {!discountBelowHardFloor && discountBelowFloor && (
              <p className="mt-2 text-xs font-semibold text-amber-700">
                margin หลังหักส่วนลดต่ำกว่า floor ({fmtPct(setting.marginFloorPct)}) — ต้องระบุเหตุผลด้านล่างก่อนออกใบเสนอราคา
              </p>
            )}
          </div>

          {sharedPlating && (
            <p className="rounded-md bg-zinc-50 px-2.5 py-2 text-xs text-zinc-500">
              ชุบร่วมรอบกันได้จริงตอนผลิต — ต้นทุนจริงอาจต่ำกว่านี้ ใช้เป็น room ตอนลูกค้าต่อราคา
            </p>
          )}

          {anyHardBlocked && (
            <p className="flex items-start gap-1.5 rounded-md border border-red-300 bg-red-50 p-2.5 text-xs font-semibold text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              มีบางรายการ margin ต่ำกว่า hard floor — ออกใบเสนอราคาไม่ได้ ไม่มีทางลัด ต้องปรับราคาหรือปฏิเสธงาน
            </p>
          )}

          {needsApprovalNote && (
            <div>
              <label htmlFor="oem-approval-note" className="text-xs font-semibold text-amber-800">
                {anyNeedsNoteFromItem || discountBelowFloor
                  ? "margin ต่ำกว่า floor — ระบุเหตุผลก่อนออกใบเสนอราคา (บังคับ)"
                  : qtyFloorShortfall
                  ? OEM_QTY_FLOOR_NOTE_TH + " (บังคับ)"
                  : manualNote
                  ? OEM_MANUAL_COST_NOTE_TH[manualNote] + " (บังคับ)"
                  : "ระบุเหตุผลก่อนออกใบเสนอราคา (บังคับ)"}
              </label>
              <textarea
                id="oem-approval-note"
                value={approvalNote}
                onChange={(e) => onApprovalNoteChange(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-amber-300 p-2 text-sm text-zinc-900"
                placeholder="เช่น ลูกค้าประจำ สั่งซ้ำแน่นอน"
              />
            </div>
          )}
        </>
      )}

      {saveError && (
        <p role="alert" className="text-xs text-red-600">
          {saveError}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" loading={savingDraft} disabled={!allInputsValid} onClick={onSaveDraft}>
          บันทึกร่าง
        </Button>
        <Button type="button" variant="primary" className="flex-1" loading={savingQuote} disabled={!canIssue} onClick={onIssueQuote}>
          ออกใบเสนอราคา
        </Button>
      </div>
    </div>
  );
}
