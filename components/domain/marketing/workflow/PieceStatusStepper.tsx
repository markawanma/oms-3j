// PieceStatusStepper — สถานะ 9 ขั้น ไม่มีเลขกำกับ (brief 0.4): ✓ = ผ่านแล้ว · จุดทึบ = ตอนนี้ · วงกลมว่าง = ยังไม่ถึง
// ทุกขั้นมีข้อความกำกับ (ไม่พึ่งสีอย่างเดียว) · <ol aria-label> + aria-current="step"
// ย่อ: "ตอนนี้: … · ถัดไป: …" แล้วกางดูครบ 9 ขั้นด้วย <details> (ไม่ต้องใช้ JS)

import { Check, Circle, CircleDot } from "lucide-react";
import { PIECE_STATUS_LABEL, STEPPER_STEPS, pieceStatusLabel, stepperIndex } from "@/lib/marketing/piece-labels";

/** ชิ้น LINE/สตอรี่: ไม่มีขั้นผลิต (ข้ามได้) และไม่มีการวัดผลรายชิ้น — ไม่แสดงขั้นที่ไม่ใช้ และไม่บอก "ถัดไป: กำลังวัดผล" */
const NOT_FOR_LINE: readonly string[] = ["produced", "measuring", "measured"];

export function PieceStatusStepper({ rawStatus, effectiveStatus, pieceKind = null }: { rawStatus: string; effectiveStatus: string; pieceKind?: string | null }) {
  const noMeasure = pieceKind === "line_message" || pieceKind === "story";
  const steps = noMeasure ? STEPPER_STEPS.filter((st) => !NOT_FOR_LINE.includes(st)) : STEPPER_STEPS;
  const fullIdx = stepperIndex(rawStatus, effectiveStatus);
  const curKey = fullIdx === null ? null : STEPPER_STEPS[fullIdx];
  const found = curKey === null ? -1 : steps.indexOf(curKey);
  // line/story ที่อยู่ขั้น "ผลิตแล้ว" ตามข้อมูลเก่า/วัดผลแล้ว: ยืนที่ปลายทาง (โพสต์แล้ว) ไม่หายจาก stepper
  const idx = found >= 0 ? found : fullIdx === null ? null : steps.length - 1;
  const next = idx === null ? null : (steps[idx + 1] ? PIECE_STATUS_LABEL[steps[idx + 1]] : null);
  const current = pieceStatusLabel(effectiveStatus);
  const side =
    effectiveStatus === "on_hold"
      ? "รอเงื่อนไข"
      : effectiveStatus === "cancelled"
        ? "ยกเลิกแล้ว"
        : effectiveStatus === "missed_measure"
          ? "พลาดรอบวัดผล"
          : null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <p className="text-sm text-zinc-900">
        <span className="text-zinc-600">ตอนนี้:</span> <span className="font-semibold">{current}</span>
        {next && !side && (
          <>
            <span className="text-zinc-400"> · </span>
            <span className="text-zinc-600">ถัดไป:</span> <span className="font-medium">{next}</span>
          </>
        )}
      </p>
      <details className="mt-1 group">
        <summary className="flex min-h-11 cursor-pointer select-none items-center text-sm font-medium text-primary-700 underline underline-offset-2">
          ดูทุกขั้นของสถานะ
        </summary>
        <ol aria-label="สถานะชิ้นงาน" className="mt-1 grid gap-1 sm:grid-cols-3">
          {steps.map((step, i) => {
            const passed = idx !== null && i < idx;
            const isCurrent = idx !== null && i === idx;
            return (
              <li
                key={step}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-sm ${
                  isCurrent ? "bg-zinc-100 font-semibold text-zinc-900" : passed ? "text-zinc-700" : "text-zinc-600"
                }`}
              >
                {passed ? (
                  <Check className="h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
                ) : isCurrent ? (
                  <CircleDot className="h-4 w-4 shrink-0 text-primary-700" aria-hidden="true" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                )}
                <span>{PIECE_STATUS_LABEL[step]}</span>
                <span className="sr-only">{passed ? "(ผ่านแล้ว)" : isCurrent ? "(ตอนนี้)" : "(ยังไม่ถึง)"}</span>
              </li>
            );
          })}
        </ol>
      </details>
      {noMeasure && !side && idx !== null && idx === steps.length - 1 && <p className="mt-1 text-xs font-medium text-zinc-700">ไม่มีการวัดผลรายชิ้น</p>}
      {side && <p className="mt-1 text-xs font-medium text-zinc-700">สถานะพิเศษ: {side}</p>}
    </div>
  );
}
