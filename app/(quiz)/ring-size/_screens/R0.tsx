import { COPY } from "@/lib/ring-size/config";
import { CardIcon, ArrowRightIcon, LockIcon, RingHero, RingSmallIcon, CheckIcon } from "../_components/Icons";
import { RsButton } from "../_components/RsButton";
import { StickyActionBar } from "../_components/StickyActionBar";
import { CARD, FOCUS, SERIF, TEXT, TEXT_2 } from "../_components/styles";

// R0 / R0Return — หน้าแรก (ตัวเดียว 2 แบบ: คนใหม่ · คนกลับมา)
//
// คนกลับมา = มีผลล่าสุด และ/หรือ เทียบจอไว้แล้วในเครื่อง — การ์ดเงื่อนไขแสดง "หลังอ่าน storage เสร็จเท่านั้น"
// (loaded=false → โครงจอเปล่า ไม่มีการ์ด · กัน hydration mismatch และภาพกระพริบ · อ่านค่าใน useEffect ที่ RingSizeClient)
// ภาพวงแหวนตกแต่งซ่อนเมื่อ 100dvh < 720 px (ปุ่มเริ่มต้องเห็นที่ 664)

export interface R0Props {
  loaded: boolean;
  /** เบอร์ของผลล่าสุด (null = ไม่มี) */
  lastResultSize: number | null;
  /** เทียบจอไว้แล้วและยังใช้ได้ */
  calibrated: boolean;
  onStart: () => void;
  onViewLastResult: () => void;
  onRedoCalibration: () => void;
}

export function R0({ loaded, lastResultSize, calibrated, onStart, onViewLastResult, onRedoCalibration }: R0Props) {
  const returning = loaded && (lastResultSize !== null || calibrated);
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col px-[22px] pb-6 pt-7">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/3j-logo.png" alt={COPY.common.logoAlt} className="h-[62px] w-auto self-center" />

        <div className="mb-1.5 mt-[26px] flex justify-center [@media(max-height:719px)]:hidden" aria-hidden="true">
          <RingHero />
        </div>

        <h1 className={`${SERIF} m-0 text-center text-[30px] font-semibold leading-[1.35] tracking-[-0.01em] ${TEXT}`}>{COPY.r0.title}</h1>
        <p className={`m-0 mt-1.5 text-center text-[16px] ${TEXT_2}`}>{returning ? COPY.r0.descReturn : COPY.r0.desc}</p>

        <ol className={`m-0 mb-[18px] mt-4 flex list-none items-center justify-center gap-2.5 p-0 text-[13px] ${TEXT_2}`}>
          {COPY.r0.steps.map((label, i) => (
            <li key={label} className="flex items-center gap-1.5">
              {i > 0 ? (
                <span aria-hidden="true" className="mr-1 text-[var(--rs-gold)]">
                  —
                </span>
              ) : null}
              <b className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[var(--rs-gold)] text-[13px] font-semibold text-[var(--rs-brand-hover)]">
                {i + 1}
              </b>
              {label}
            </li>
          ))}
        </ol>

        <section aria-label={COPY.r0.prepTitle} className={`${CARD} flex flex-col gap-3.5 p-[18px]`}>
          <h2 className={`${SERIF} m-0 text-[17px] font-semibold ${TEXT}`}>{COPY.r0.prepTitle}</h2>
          <div className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[var(--rs-blush)] text-[var(--rs-brand)]">
              <CardIcon />
            </span>
            <span className={`text-[15px] ${TEXT}`}>{COPY.r0.prep1}</span>
          </div>
          <div className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[var(--rs-blush)] text-[var(--rs-brand)]">
              <RingSmallIcon />
            </span>
            <span className={`text-[15px] ${TEXT}`}>{COPY.r0.prep2}</span>
          </div>
        </section>

        {loaded && lastResultSize !== null ? (
          <div className={`${CARD} mt-3 flex items-center justify-between gap-3 px-4 py-2`}>
            <span className={`text-[15px] font-medium ${TEXT}`}>{COPY.r0.lastResult(lastResultSize)}</span>
            <button
              type="button"
              onClick={onViewLastResult}
              className={`inline-flex min-h-[44px] items-center font-semibold text-[var(--rs-brand)] underline-offset-4 hover:underline ${FOCUS}`}
            >
              {COPY.r0.lastResultAction}
            </button>
          </div>
        ) : null}

        {loaded && calibrated ? (
          <div className="mt-3 flex items-center gap-2.5 rounded-[14px] bg-[var(--rs-success)] px-3.5 py-1.5 text-[14px] text-[var(--rs-success-text)]">
            <CheckIcon size={18} />
            <span className="flex-1 leading-snug">{COPY.r0.calibrated}</span>
            <button
              type="button"
              onClick={onRedoCalibration}
              className={`inline-flex min-h-[44px] items-center px-1 font-semibold underline-offset-4 hover:underline ${FOCUS}`}
            >
              {COPY.r0.calibratedAction}
            </button>
          </div>
        ) : null}
      </div>

      <StickyActionBar>
        <RsButton onClick={onStart} icon={<span className="order-last"><ArrowRightIcon /></span>}>
          {COPY.r0.cta}
        </RsButton>
        <p className={`m-0 mt-2 flex items-start justify-center gap-2 text-center text-[13px] ${TEXT_2}`}>
          <LockIcon className="mt-1 shrink-0" />
          <span>{COPY.r0.privacy}</span>
        </p>
      </StickyActionBar>
    </div>
  );
}
