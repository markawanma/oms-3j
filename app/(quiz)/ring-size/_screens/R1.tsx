import { COPY } from "@/lib/ring-size/config";
import { CardOnPhoneFigure } from "../_components/Icons";
import { RsButton } from "../_components/RsButton";
import { RsHeader } from "../_components/RsHeader";
import { StickyActionBar } from "../_components/StickyActionBar";
import { CARD, FOCUS, SERIF, TEXT, TEXT_2, TEXT_3 } from "../_components/styles";

// R1 — สอนเทียบด้วยบัตร (ขั้น 1) · ลิงก์ล่าง "ไม่สะดวกใช้บัตร? ใช้เหรียญ 10 บาทแทน" → R2Coin
export function R1({
  step,
  onBack,
  onNext,
  onUseCoin,
}: {
  step: { current: number; total: number } | null;
  onBack: () => void;
  onNext: () => void;
  onUseCoin: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <RsHeader step={step} onBack={onBack} />
      <div className="flex flex-1 flex-col gap-3.5 px-[22px] pb-6">
        <h1 className={`${SERIF} m-0 mt-2.5 text-[25px] font-semibold leading-[1.4] ${TEXT}`}>{COPY.teachCard.title}</h1>
        <p className={`m-0 text-[15px] ${TEXT_2}`}>{COPY.teachCard.explain}</p>

        <figure className={`${CARD} m-0 px-3 py-3.5`}>
          <CardOnPhoneFigure label={COPY.teachCard.figureAlt} />
        </figure>

        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {COPY.teachCard.steps.map((t, i) => (
            <li key={t} className={`flex items-start gap-3 text-[15px] ${TEXT}`}>
              <span className="mt-px flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[var(--rs-brand)] text-[13px] font-semibold text-white">
                {i + 1}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ol>

        <div className={`rounded-[16px] bg-[var(--rs-blush)] px-3.5 py-3 text-[14px] leading-relaxed text-[var(--rs-blush-text)]`}>{COPY.teachCard.tip}</div>
      </div>

      <StickyActionBar>
        <RsButton onClick={onNext}>{COPY.teachCard.cta}</RsButton>
        <button
          type="button"
          onClick={onUseCoin}
          className={`mx-auto inline-flex min-h-[44px] items-center justify-center px-2 text-[15px] font-medium underline-offset-4 hover:underline ${TEXT_3} ${FOCUS}`}
        >
          {COPY.teachCard.useCoin}
        </button>
      </StickyActionBar>
    </div>
  );
}
