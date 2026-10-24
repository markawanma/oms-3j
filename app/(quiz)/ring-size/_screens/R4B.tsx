import { COPY, PAPER_SIZE_HINT, SHOW_KNUCKLE_RULE } from "@/lib/ring-size/config";
import { PaperWrapFigure } from "../_components/Icons";
import { RsButton } from "../_components/RsButton";
import { RsHeader } from "../_components/RsHeader";
import { StickyActionBar } from "../_components/StickyActionBar";
import { CARD, FOCUS, SERIF, TEXT, TEXT_3 } from "../_components/styles";

// R4B — สอนวัดด้วยกระดาษพันนิ้ว
// 🔴 ค่าที่ยังไม่ยืนยัน (build spec ข้อ 5):
//   - ขนาดกระดาษ (PAPER_SIZE_HINT) = null → ใช้ข้อความไม่มีตัวเลข
//   - กล่องข้อนิ้ว + กฎ "ใช้ค่าที่ใหญ่กว่า" (SHOW_KNUCKLE_RULE) = false → ไม่ render
export function R4B({
  step,
  onBack,
  onNext,
  onSwitchA,
}: {
  step: { current: number; total: number } | null;
  onBack: () => void;
  onNext: () => void;
  onSwitchA: () => void;
}) {
  const steps = [PAPER_SIZE_HINT ?? COPY.r4b.step1NoHint, COPY.r4b.step2, COPY.r4b.step3, COPY.r4b.step4];
  return (
    <div className="flex flex-1 flex-col">
      <RsHeader step={step} onBack={onBack} />
      <div className="flex flex-1 flex-col gap-3.5 px-[22px] pb-6">
        <h1 className={`${SERIF} m-0 mt-2.5 text-[25px] font-semibold ${TEXT}`}>{COPY.r4b.title}</h1>

        <figure className={`${CARD} m-0 px-3 py-3.5`}>
          <PaperWrapFigure label={COPY.r4b.figureAlt} />
        </figure>

        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {steps.map((t, i) => (
            <li key={t} className={`flex items-start gap-3 text-[15px] ${TEXT}`}>
              <span className="mt-px flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[var(--rs-brand)] text-[13px] font-semibold text-white">
                {i + 1}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ol>

        {SHOW_KNUCKLE_RULE ? (
          <div className="rounded-[16px] bg-[var(--rs-warn)] px-3.5 py-3 text-[15px] leading-relaxed text-[var(--rs-warn-text)]">{COPY.r4b.knuckle}</div>
        ) : null}
      </div>

      <StickyActionBar>
        <RsButton onClick={onNext}>{COPY.r4b.cta}</RsButton>
        <button
          type="button"
          onClick={onSwitchA}
          className={`mx-auto inline-flex min-h-[44px] items-center justify-center px-2 text-[15px] font-medium underline-offset-4 hover:underline ${TEXT_3} ${FOCUS}`}
        >
          {COPY.r4b.switchA}
        </button>
      </StickyActionBar>
    </div>
  );
}
