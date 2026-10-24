import { COPY, type Method } from "@/lib/ring-size/config";
import { CheckIcon } from "../_components/Icons";
import { OptionCard } from "../_components/OptionCard";
import { RsHeader } from "../_components/RsHeader";
import { FOCUS, SERIF, TEXT, TEXT_2 } from "../_components/styles";

// R3 — เลือกวิธีวัด · แถบ "เทียบหน้าจอเรียบร้อย · เทียบใหม่" (role=status · fade-up แบบ motion-safe · ลิงก์ ≥ 44 px)
// ไม่มี pill ความแม่น/เวที (มติ Q1: ความแม่นชุดเดียว · เวลา 30 วินาทียังไม่จับเวลา) · ตัวนับ dynamic ตาม state
// การ์ดภาพเล็กเป็นภาพสอน (วาดวัตถุได้ ไม่ใช่เวที)

function RingOnPhoneArt() {
  return (
    <svg width="54" height="54" viewBox="0 0 54 54" fill="none" aria-hidden="true">
      <rect x="9" y="4" width="36" height="46" rx="7" stroke="#2B1E1E" strokeWidth="1.6" />
      <circle cx="27" cy="27" r="11" stroke="#a2191d" strokeWidth="5" />
    </svg>
  );
}

function PaperArt() {
  return (
    <svg width="54" height="54" viewBox="0 0 54 54" fill="none" aria-hidden="true">
      <path d="M18 8v38" stroke="#2B1E1E" strokeWidth="7" strokeLinecap="round" />
      <path d="M10 24h18" stroke="#a2191d" strokeWidth="4" />
      <path d="M34 10l8 36" stroke="#C8A777" strokeWidth="2" />
      <path d="M40 38l2 8" stroke="#2B1E1E" strokeWidth="3" />
    </svg>
  );
}

const ART = "flex h-[84px] w-[84px] items-center justify-center rounded-[18px] bg-[var(--rs-blush)]";

export function R3({
  step,
  onBack,
  onPick,
  onRedo,
}: {
  step: { current: number; total: number } | null;
  onBack: () => void;
  onPick: (m: Method) => void;
  onRedo: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <RsHeader step={step} onBack={onBack} />
      <div className="flex flex-1 flex-col px-[22px] pb-6">
        <div
          role="status"
          className="mt-2 flex items-center gap-2.5 rounded-[14px] bg-[var(--rs-success)] px-3.5 py-1 text-[14px] text-[var(--rs-success-text)] motion-safe:animate-gq-fade-up"
        >
          <CheckIcon size={18} />
          <span className="flex-1">{COPY.calibrated.bar}</span>
          <button
            type="button"
            onClick={onRedo}
            className={`inline-flex min-h-[44px] items-center px-2 font-semibold underline-offset-4 hover:underline ${FOCUS}`}
          >
            {COPY.calibrated.redo}
          </button>
        </div>

        <h1 className={`${SERIF} m-0 mb-3.5 mt-[18px] text-[25px] font-semibold ${TEXT}`}>{COPY.r3.title}</h1>

        <div className="flex flex-col gap-3">
          <OptionCard
            art={
              <span className={ART}>
                <RingOnPhoneArt />
              </span>
            }
            title={COPY.r3.aTitle}
            desc={COPY.r3.aDesc}
            onClick={() => onPick("A")}
          />
          <OptionCard
            art={
              <span className={ART}>
                <PaperArt />
              </span>
            }
            title={COPY.r3.bTitle}
            desc={COPY.r3.bDesc}
            onClick={() => onPick("B")}
          />
        </div>

        <p className={`m-0 mx-1 mt-4 text-[14px] ${TEXT_2}`}>{COPY.r3.help}</p>
      </div>
    </div>
  );
}
