import { COPY, MEASURE, type Method } from "@/lib/ring-size/config";
import { helpLineHref } from "@/lib/ring-size/line-message";
import { circSide, formatMm } from "@/lib/ring-size/size";
import { WarnIcon } from "../_components/Icons";
import { RsButton } from "../_components/RsButton";
import { RsHeader } from "../_components/RsHeader";
import { CARD, FOCUS, SERIF, TEXT, TEXT_3 } from "../_components/styles";

// G4 — ค่าที่วัดได้อยู่นอกช่วงแหวนผู้ใหญ่ (เส้นรอบวง 40–75 มม.) → ไม่ขึ้นผล
// ข้อความตามทิศ (เล็ก/ใหญ่) และวิธี (เช็กลิสต์ A/B) · "วัดใหม่" → R5A/R5B ตาม method · "เทียบหน้าจอใหม่" → R1Pick
// role=alert (ผู้ใช้ต้องรู้ว่าไม่มีผล)
export function G4({
  step,
  circ,
  diameterMm = null,
  method,
  onBack,
  onRemeasure,
  onRecalibrate,
}: {
  step: { current: number; total: number } | null;
  /** เส้นรอบวงที่ปัด 0.1 แล้ว */
  circ: number;
  /** วิธีแหวน: เส้นผ่านศูนย์กลางที่ผู้ใช้เห็น (มม.) — ใช้บอกในข้อความคู่กับเส้นรอบวง */
  diameterMm?: number | null;
  method: Method;
  onBack: () => void;
  onRemeasure: () => void;
  onRecalibrate: () => void;
}) {
  const side = circSide(circ) ?? "เล็ก";
  const checklist = method === "B" ? COPY.g4.checkB : COPY.g4.checkA;
  return (
    <div className="flex flex-1 flex-col">
      <RsHeader step={step} onBack={onBack} />
      <div className="flex flex-1 flex-col items-center gap-4 px-[22px] pb-6 pt-8 text-center">
        <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full border border-[var(--rs-warn-border)] bg-[var(--rs-warn)] text-[var(--rs-warn-icon)]">
          <WarnIcon size={36} />
        </span>
        <div role="alert" className="flex flex-col items-center gap-3">
          <h1 className={`${SERIF} m-0 text-[24px] font-semibold leading-snug ${TEXT}`}>{COPY.g4.title}</h1>
          <p className={`m-0 text-[15px] leading-relaxed ${TEXT_3}`}>{method === "A" && diameterMm !== null
              ? COPY.g4.bodyDiameter(formatMm(diameterMm), formatMm(circ), side, MEASURE.G4[0], MEASURE.G4[1])
              : COPY.g4.body(formatMm(circ), side, MEASURE.G4[0], MEASURE.G4[1])}</p>
        </div>

        <section className={`${CARD} w-full p-4 text-left`} aria-label={COPY.g4.checklistTitle}>
          <h2 className={`${SERIF} m-0 mb-2 text-[16px] font-semibold ${TEXT}`}>{COPY.g4.checklistTitle}</h2>
          <ul className={`m-0 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-snug ${TEXT_3}`}>
            {checklist.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>

        <div className="mt-1 flex w-full flex-col gap-2.5">
          <RsButton onClick={onRemeasure}>{COPY.g4.remeasure}</RsButton>
          <RsButton variant="secondary" href={helpLineHref()}>
            {COPY.g4.askLine}
          </RsButton>
          <button
            type="button"
            onClick={onRecalibrate}
            className={`mx-auto inline-flex min-h-[44px] items-center justify-center px-2 text-[15px] font-semibold text-[var(--rs-brand)] underline-offset-4 hover:underline ${FOCUS}`}
          >
            {COPY.g4.recalibrate}
          </button>
        </div>
      </div>
    </div>
  );
}
