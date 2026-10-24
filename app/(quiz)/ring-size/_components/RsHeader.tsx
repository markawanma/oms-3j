import { COPY } from "@/lib/ring-size/config";
import { BackIcon } from "./Icons";
import { FOCUS, SERIF, TEXT, TEXT_2 } from "./styles";

// RsHeader — ปุ่มย้อน 44×44 · ตัวนับขั้น (aria-label "ขั้นที่ 1 จาก 3") · มาร์ก 3J
// ตัวนับ dynamic ตาม state (คนใหม่ 01/03 · คนกลับมา 01/02) — คำนวณที่ lib/ring-size/flow.ts

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export const HEADER_PX = 56;

export function RsHeader({ step, onBack }: { step?: { current: number; total: number } | null; onBack?: () => void }) {
  return (
    <header className="flex shrink-0 items-center justify-between px-[22px] pb-0.5 pt-1.5">
      {onBack ? (
        <button
          type="button"
          aria-label={COPY.common.back}
          onClick={onBack}
          className={`-ml-2 flex h-11 w-11 items-center justify-center rounded-full ${TEXT} hover:bg-[var(--rs-blush)] ${FOCUS}`}
        >
          <BackIcon />
        </button>
      ) : (
        <span className="h-11 w-11" aria-hidden="true" />
      )}
      {step ? (
        <span
          aria-label={COPY.common.stepAria(step.current, step.total)}
          className={`${SERIF} text-[14px] tracking-[0.18em] ${TEXT_2}`}
        >
          {pad2(step.current)} / {pad2(step.total)}
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/ring-size/3j-mark.png" alt={COPY.common.markAlt} className="h-[30px] w-auto" />
    </header>
  );
}
