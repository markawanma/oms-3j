import { COPY } from "@/lib/ring-size/config";
import { RingEdgeFigure } from "../_components/Icons";
import { RsButton } from "../_components/RsButton";
import { RsHeader } from "../_components/RsHeader";
import { StickyActionBar } from "../_components/StickyActionBar";
import { CARD, FOCUS, SERIF, TEXT, TEXT_3 } from "../_components/styles";

// R4A — สอนวัดด้วยแหวนวงเดิม: จุดผิดที่เจอบ่อยสุดคือวัดขอบนอก → ภาพ ✓/✗ ใหญ่ + ข้อควรระวังตัวหนา
// ภาพสอนวาดแหวนได้ (ไม่ใช่เวทีวัด)
export function R4A({
  step,
  onBack,
  onNext,
  onSwitchB,
}: {
  step: { current: number; total: number } | null;
  onBack: () => void;
  onNext: () => void;
  onSwitchB: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <RsHeader step={step} onBack={onBack} />
      <div className="flex flex-1 flex-col gap-3.5 px-[22px] pb-6">
        <h1 className={`${SERIF} m-0 mt-2.5 text-[25px] font-semibold ${TEXT}`}>{COPY.r4a.title}</h1>

        <figure className={`${CARD} m-0 flex items-center gap-2 px-3 py-3.5`}>
          <RingEdgeFigure label={COPY.r4a.figureAlt} size={150} />
          <figcaption className="flex flex-col gap-10 text-[13px] leading-snug">
            <span className="text-[var(--rs-text-3)]">
              <strong className="text-[var(--rs-success-text)]">{COPY.r4a.inner}</strong>
              <br />
              {COPY.r4a.innerSub}
            </span>
            <span className="text-[var(--rs-text-3)]">
              <strong className="text-[#8E1B1B]">{COPY.r4a.outer}</strong>
              <br />
              {COPY.r4a.outerSub}
            </span>
          </figcaption>
        </figure>

        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {COPY.r4a.steps.map((t, i) => (
            <li key={t} className={`flex items-start gap-3 text-[15px] ${TEXT}`}>
              <span className="mt-px flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[var(--rs-brand)] text-[13px] font-semibold text-white">
                {i + 1}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ol>

        <div className="rounded-[16px] bg-[var(--rs-warn)] px-3.5 py-3 text-[15px] leading-relaxed text-[var(--rs-warn-text)]">
          <strong className="font-semibold">{COPY.r4a.warnStrong}</strong>
          {COPY.r4a.warnRest}
        </div>
      </div>

      <StickyActionBar>
        <RsButton onClick={onNext}>{COPY.r4a.cta}</RsButton>
        <button
          type="button"
          onClick={onSwitchB}
          className={`mx-auto inline-flex min-h-[44px] items-center justify-center px-2 text-[15px] font-medium underline-offset-4 hover:underline ${TEXT_3} ${FOCUS}`}
        >
          {COPY.r4a.switchB}
        </button>
      </StickyActionBar>
    </div>
  );
}
