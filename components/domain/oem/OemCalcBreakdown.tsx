"use client";

// OemCalcBreakdown — pure display of an OemPriceCalcResult (price/NRE/margin/
// floors/cost breakdown/missing list). Shared by QuoteResultPanel (live
// preview on /oem/quote) and QuoteDetailClient (saved quote on
// /oem/quotes/[id]) so the two never drift. Zero arithmetic on cost/price/
// margin — formatting and reading already-computed fields only.

import Link from "next/link";
import { AlertTriangle, Package } from "lucide-react";
import type { OemBatchLine, OemMetal, OemMissingRateEntry, OemPriceBreakdown, OemPriceCalcResult } from "@/lib/oem/types";
import { fmtPct } from "@/lib/oem/display";
import { formatTHB } from "@/lib/format";

function FloorChip({ label, pass }: { label: string; pass: boolean | null }) {
  const cls =
    pass === true
      ? "border-green-300 bg-green-50 text-green-800"
      : pass === false
      ? "border-red-300 bg-red-50 text-red-800"
      : "border-zinc-300 bg-zinc-50 text-zinc-500";
  const text = pass === true ? "ผ่าน" : pass === false ? "ไม่ผ่าน" : "ยังบอกไม่ได้";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${cls}`}>
      {label}: {text}
    </span>
  );
}

/** 0066 CFO requirement: always show the gross sprue % NEXT TO the net
 * ("effective") % the price actually used — never just the net number alone.
 * This is the direct fix for how the old bug survived: gross sprue was
 * charged in full while nobody could see, on this screen, that it didn't
 * match what should have been charged after recovery — the wrong number and
 * the right number were never on screen together, so no one caught it. Every
 * field read here comes straight off oem_price_calc's breakdown.metal
 * (0066); this component does NOT recompute L_eff or the multiplier. */
function MetalLossLine({
  metal,
  missing,
  formulaVersion,
}: {
  metal: OemPriceBreakdown["metal"];
  missing: OemMissingRateEntry[];
  formulaVersion: number;
}) {
  const missingSprue = metal.grossLossPct == null;
  const missingRecovery = missing.some((m) => m.rateKey === "recovery_rate_pct");
  const missingPolish = missing.some((m) => m.rateKey === "polish_loss_pct");

  if (missingSprue) {
    return (
      <div className="text-xs text-amber-700">ยังไม่ได้กรอกอัตราก้านต้น (sprue) — ตัวเลขเนื้อโลหะข้างบนยังไม่รวมค่าสูญเสียโลหะ</div>
    );
  }

  // Saved quotes are a snapshot of calc at the time they were quoted — a
  // quote priced under the pre-0066 formula (gross sprue charged in full, no
  // recovery netting) still returns lossBasis/effectiveLossPct shaped like
  // today's contract, but they were never the number the price used. Say so
  // instead of silently presenting an old quote's gross loss as if it were
  // net.
  if (formulaVersion < 3) {
    return (
      <div className="text-xs text-amber-700">
        ก้านต้น {fmtPct(metal.grossLossPct)} · ใบนี้คิดด้วยสูตรเดิม (คิดก้านต้นเต็ม ไม่หักหลอมคืน) — ถ้าจะยึดตัวเลขนี้ ให้กดคิดใหม่
      </div>
    );
  }

  const grossTxt = fmtPct(metal.grossLossPct);
  const effTxt = fmtPct(metal.effectiveLossPct);
  const multTxt = metal.metalLossMultiplier != null ? `×${metal.metalLossMultiplier.toFixed(3)}` : "—";

  // Fail-safe path (0066 header): while recovery/polish are unfilled the RPC
  // silently falls back to gross-sprue behaviour so prices don't move — say
  // that out loud instead of drawing an arrow that implies a real net figure.
  if (missingRecovery || missingPolish) {
    const missingParts = [missingRecovery && "อัตราหลอมคืน", missingPolish && "อัตราขัดหาย"].filter(Boolean).join(" · ");
    return (
      <div className="text-xs text-amber-700">
        ก้านต้น {grossTxt} · ยังไม่ได้กรอก: {missingParts} → ใช้สูตรสำรองชั่วคราว (เท่ากับก้านต้นเต็ม): สูญจริง {effTxt} ({multTxt})
      </div>
    );
  }

  const polishTxt = fmtPct(metal.polishLossPct);
  return (
    <div className="text-xs text-zinc-500">
      ก้านต้น {grossTxt} · ขัดหาย {polishTxt} (หลังหักหลอมคืนแล้ว) → สูญจริง {effTxt} ({multTxt})
    </div>
  );
}

/** Reads count/capacity/q_run the RPC already computed — how many more
 * pieces would fill the LAST flask/plating batch exactly. Not a price calc. */
function fillHint(line: OemBatchLine, qRun: number): string | null {
  if (line.count == null || line.capacity == null || line.capacity <= 0 || line.count <= 0) return null;
  const lastBatchUsage = qRun - (line.count - 1) * line.capacity;
  const remaining = line.capacity - lastBatchUsage;
  if (remaining <= 0) return null;
  const label = line.key === "flask" ? "แฟลสก์" : "รอบชุบ";
  return `${label}ใบสุดท้ายใช้ ${lastBatchUsage}/${line.capacity} ชิ้น — เพิ่มอีก ${remaining} ชิ้นจะเต็มพอดี (ราคา/ชิ้นจะถูกลง)`;
}

export function OemCalcBreakdown({
  calc,
  metal,
  approvalNoteSlot,
}: {
  calc: OemPriceCalcResult;
  metal: OemMetal;
  /** optional extra content rendered inside the margin card, right after the
   * hard-floor/needs-note copy (QuoteResultPanel slots its approval textarea
   * here; QuoteDetailClient omits it — a saved quote's note is read-only). */
  approvalNoteSlot?: React.ReactNode;
}) {
  const floors = calc.floors;
  const marginState = floors.margin.state;
  const hardBlocked = marginState === "hard_floor_breach";
  const needsNote = marginState === "needs_approval_note";

  // While rates are missing the RPC still returns a per-piece price, but it is
  // built with the un-entered components coalesced to 0 — i.e. it is always
  // LOWER than the real cost, by an unknown amount. Showing it as a number is
  // worse than showing nothing: someone can read it off the screen and quote a
  // customer below cost. Only quoteTotal is nulled server-side, so the
  // per-piece figures have to be suppressed here.
  const incomplete = !calc.isComplete;

  return (
    <>
      {/* price */}
      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-500">ราคา/ชิ้น</span>
          <span className="text-xl font-bold tabular-nums text-zinc-900">
            {incomplete ? "—" : formatTHB(calc.breakdown.pricePerPiece)}
          </span>
        </div>
        {incomplete && (
          <p className="mt-1 text-xs text-amber-700">
            ยังคิดราคาไม่ได้ — ขาดต้นทุน {calc.missing.length} รายการ (ดูด้านล่าง) ตัวเลขที่คำนวณได้ตอนนี้จะต่ำกว่าความจริง
          </p>
        )}
        {!incomplete && calc.breakdown.nre.price > 0 && (
          <div className="mt-1.5 flex items-baseline justify-between border-t border-dashed border-zinc-200 pt-1.5">
            <span className="text-xs text-zinc-500">NRE (เก็บครั้งเดียว แยกจากราคาชิ้น)</span>
            <span className="text-sm font-semibold tabular-nums text-zinc-700">{formatTHB(calc.breakdown.nre.price)}</span>
          </div>
        )}
        <div className="mt-1.5 flex items-baseline justify-between border-t border-zinc-200 pt-1.5">
          <span className="text-sm font-semibold text-zinc-700">ยอดรวม</span>
          <span className="text-2xl font-bold tabular-nums text-primary-700">
            {calc.breakdown.quoteTotal != null ? formatTHB(calc.breakdown.quoteTotal) : "—"}
          </span>
        </div>
      </div>

      {/* margin */}
      <div
        className={`rounded-lg border p-3.5 shadow-sm ${
          hardBlocked ? "border-red-300 bg-red-50" : needsNote ? "border-amber-300 bg-amber-50" : "border-zinc-200 bg-white"
        }`}
      >
        <span className="text-xs text-zinc-500">margin ที่คิด</span>
        <div className="text-2xl font-bold tabular-nums text-zinc-900">{fmtPct(floors.margin.value)}</div>
        <p className="mt-0.5 text-xs text-zinc-500">
          margin รวมทั้งงาน {fmtPct(floors.margin.blended)}
          {floors.margin.target != null && ` · เป้าหมาย ${fmtPct(floors.margin.target)}`}
        </p>
        {metal === "gold" && (
          <p className="mt-1 text-xs text-zinc-500">
            งานทองเป็น pass-through: มาร์จิ้นคิดเฉพาะค่ากำเหน็จ ไม่คิดทับเนื้อทอง — margin รวมทั้งงานจึงต่ำกว่ามากโดยตั้งใจ ไม่ใช่บั๊ก
          </p>
        )}
        {hardBlocked && (
          <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ต่ำกว่า hard floor — ออกใบเสนอราคาไม่ได้ ไม่มีทางลัด ต้องปรับราคาหรือปฏิเสธงาน
          </p>
        )}
        {needsNote && approvalNoteSlot}
      </div>

      {/* floor chips */}
      <div className="flex flex-wrap gap-1.5">
        <FloorChip label={`จำนวน (MOQ ${floors.qty.moq ?? "?"})`} pass={floors.qty.pass} />
        <FloorChip label={`มูลค่างาน (ขั้นต่ำ ${formatTHB(floors.jobValue.min)})`} pass={floors.jobValue.pass} />
        {floors.metalWeight.applies && <FloorChip label="น้ำหนักทองรวม" pass={floors.metalWeight.pass} />}
      </div>

      {/* cost breakdown */}
      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">ต้นทุนต่อชิ้น</h3>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-zinc-600">เนื้อโลหะ</dt>
            <dd className="tabular-nums text-zinc-800">{formatTHB(calc.breakdown.metal.perPiece)}</dd>
          </div>
          <dd className="col-span-2">
            <MetalLossLine metal={calc.breakdown.metal} missing={calc.missing} formulaVersion={calc.formulaVersion} />
          </dd>
          <div className="flex justify-between">
            <dt className="text-zinc-600">ค่าแรง</dt>
            <dd className="tabular-nums text-zinc-800">{formatTHB(calc.breakdown.labor.perPiece)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-600">Batch (แฟลสก์/ชุบ ÷ จำนวน)</dt>
            <dd className="tabular-nums text-zinc-800">{formatTHB(calc.breakdown.batch.perPiece)}</dd>
          </div>
          <div className="flex justify-between border-t border-zinc-100 pt-1 font-semibold">
            <dt className="text-zinc-700">รวมต้นทุน/ชิ้น</dt>
            <dd className="tabular-nums text-zinc-900">{formatTHB(calc.breakdown.costPiece)}</dd>
          </div>
        </dl>

        {calc.breakdown.labor.steps.length > 0 && (
          <details className="mt-2.5">
            <summary className="cursor-pointer text-xs font-medium text-primary-700">ดูค่าแรงแยกขั้นตอน</summary>
            <ul className="mt-1.5 space-y-0.5 text-xs text-zinc-500">
              {calc.breakdown.labor.steps.map((s) => (
                <li key={s.key} className="flex justify-between">
                  <span>
                    {s.key}
                    {s.minutes != null && ` (${s.minutes} นาที)`}
                  </span>
                  <span className="tabular-nums">{formatTHB(s.thb)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {calc.breakdown.batch.lines.length > 0 && (
          <div className="mt-2.5 space-y-1.5 border-t border-zinc-100 pt-2">
            {calc.breakdown.batch.lines.map((l) => (
              <div key={l.key} className="flex items-start gap-1.5 text-xs text-zinc-600">
                <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                <div>
                  <p>
                    {l.key === "flask" ? "แฟลสก์" : "รอบชุบ"}: {l.count ?? "?"} รอบ × ความจุ {l.capacity ?? "?"} ชิ้น
                    {l.cost != null && ` = ${formatTHB(l.cost)}`}
                  </p>
                  {l.count != null &&
                    (() => {
                      const hint = fillHint(l, calc.breakdown.qRun);
                      return hint ? <p className="text-amber-700">{hint}</p> : null;
                    })()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* missing rates */}
      {!calc.isComplete && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-800">ข้อมูลต้นทุนยังไม่ครบ ({calc.missing.length} รายการ)</p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-700">
            {calc.missing.slice(0, 8).map((m) => (
              <li key={`${m.rateKey}-${m.scope}`}>
                <Link href={`/oem/rates#oem-rate-${m.rateKey}-${m.scope}`} className="underline underline-offset-2 hover:no-underline">
                  {m.questionTh}
                </Link>
              </li>
            ))}
            {calc.missing.length > 8 && <li>…และอีก {calc.missing.length - 8} รายการ</li>}
          </ul>
        </div>
      )}

      {calc.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-zinc-500">
          {calc.warnings.map((w, i) => (
            <li key={i}>· {w}</li>
          ))}
        </ul>
      )}
    </>
  );
}
