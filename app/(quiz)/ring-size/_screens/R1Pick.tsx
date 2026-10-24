import { COPY, type RefKind } from "@/lib/ring-size/config";
import { CameraOffIcon, CardPickArt, CoinPickArt } from "../_components/Icons";
import { NoticeBar } from "../_components/NoticeBar";
import { OptionCard } from "../_components/OptionCard";
import { RsHeader } from "../_components/RsHeader";
import { CARD, SERIF, TEXT, TEXT_2 } from "../_components/styles";

// R1Pick — เลือกของเทียบจอ: เหรียญ 10 บาท / บัตร (ไม่เก็บ ref จนกว่าเทียบเสร็จ)
// ป้ายการ์ดบัตรไม่มี "แม่นที่สุด" (มติ Q1) · กล่องส่วนตัวย่อ ≤ 2 บรรทัดเนื้อหา · ห้ามมีคำสัญญาที่ตรวจสอบไม่ได้

export function R1Pick({
  step,
  onBack,
  onPick,
  missingCalibration,
}: {
  step: { current: number; total: number } | null;
  onBack: () => void;
  onPick: (ref: RefKind) => void;
  /** เข้าจอวัดโดยไม่มีค่าเทียบ (รีโหลด/Back เก่า) → ข้อความบอกเหตุผล */
  missingCalibration: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <RsHeader step={step} onBack={onBack} />
      <div className="flex flex-1 flex-col px-[22px] pb-6">
        <h1 className={`${SERIF} m-0 mb-1 mt-2.5 text-[25px] font-semibold leading-[1.4] ${TEXT}`}>{COPY.pick.title}</h1>
        <p className={`m-0 text-[15px] ${TEXT_2}`}>{COPY.pick.sub}</p>

        {missingCalibration ? (
          <NoticeBar tone="warn" role="status" className="mt-3">
            {COPY.pick.missingCalibration}
          </NoticeBar>
        ) : null}

        <div className="mt-5 flex flex-col gap-3">
          <OptionCard
            art={<CoinPickArt />}
            title={COPY.pick.coinTitle}
            desc={COPY.pick.coinDesc}
            badge={{ text: COPY.pick.coinBadge, tone: "success" }}
            onClick={() => onPick("coin")}
          />
          <OptionCard
            art={<CardPickArt />}
            title={COPY.pick.cardTitle}
            desc={COPY.pick.cardDesc}
            badge={{ text: COPY.pick.cardBadge, tone: "blush" }}
            onClick={() => onPick("card")}
          />
        </div>

        <section aria-label={COPY.pick.privacyTitle} className={`${CARD} mt-[18px] flex gap-3 rounded-[20px] p-4`}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--rs-blush)] text-[var(--rs-brand-hover)]">
            <CameraOffIcon />
          </span>
          <div className="text-[14px] leading-relaxed text-[var(--rs-text-3)]">
            <strong className={`${SERIF} block text-[15px] font-semibold ${TEXT}`}>{COPY.pick.privacyTitle}</strong>
            {COPY.pick.privacyBody}
          </div>
        </section>

        <div className="flex-1" />
        <p className={`m-0 mt-5 text-center text-[13px] ${TEXT_2}`}>{COPY.pick.footer}</p>
      </div>
    </div>
  );
}
