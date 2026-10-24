import type { ReactNode } from "react";
import { ChevronRightIcon } from "./Icons";
import { BRAND_TEXT, FOCUS, SERIF, TEXT, TEXT_2 } from "./styles";

// OptionCard — การ์ดตัวเลือก (R1Pick · R3) · เป็น <button> ทั้งใบ (พื้นที่แตะ ≥ 96 px สูง)

const BADGE_TONE = {
  success: "bg-[var(--rs-success)] text-[var(--rs-success-text)]",
  blush: "bg-[var(--rs-blush)] text-[var(--rs-blush-text)]",
  chip: "bg-[var(--rs-chip-bg)] text-[var(--rs-text-3)]",
} as const;

export function OptionCard({
  art,
  title,
  desc,
  badge,
  onClick,
}: {
  art: ReactNode;
  title: string;
  desc: string;
  badge?: { text: string; tone: keyof typeof BADGE_TONE };
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[96px] w-full items-center gap-3.5 rounded-[var(--rs-radius-card)] border-[1.5px] border-[var(--rs-border)] bg-[var(--rs-surface)] p-4 text-left ${TEXT} transition-colors hover:border-[var(--rs-brand)] ${FOCUS}`}
    >
      <span className="flex shrink-0 items-center justify-center">{art}</span>
      <span className="min-w-0 flex-1">
        <span className={`${SERIF} block text-[18px] font-semibold leading-snug`}>{title}</span>
        <span className={`block text-[14px] ${TEXT_2}`}>{desc}</span>
        {badge ? (
          <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${BADGE_TONE[badge.tone]}`}>{badge.text}</span>
        ) : null}
      </span>
      <ChevronRightIcon className={`shrink-0 ${BRAND_TEXT}`} />
    </button>
  );
}
