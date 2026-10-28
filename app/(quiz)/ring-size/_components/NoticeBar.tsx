import type { ReactNode } from "react";
import { CheckIcon, WarnIcon } from "./Icons";
import { FOCUS } from "./styles";

// NoticeBar — แถบแจ้งเหนือเวที/บนจอ: G1 (alert · บล็อก) · G5/G2-inline (status) · "เทียบหน้าจอเรียบร้อย" (success)
// tone กำหนดสี · role กำหนดระดับการประกาศ (alert = บล็อก/ต้องรู้ทันที · status = แจ้ง)

const TONE = {
  warn: "border border-[var(--rs-warn-border)] bg-[var(--rs-warn)] text-[var(--rs-warn-text)]",
  success: "bg-[var(--rs-success)] text-[var(--rs-success-text)]",
} as const;

export function NoticeBar({
  tone,
  role,
  children,
  action,
  className,
  animate = false,
}: {
  tone: keyof typeof TONE;
  role: "status" | "alert";
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
  /** fade-up ตอนเข้า (motion-safe เท่านั้น — reduced-motion ปิดผ่าน CSS) */
  animate?: boolean;
}) {
  return (
    <div
      role={role}
      className={`flex items-start gap-2.5 rounded-[14px] px-3.5 py-2.5 text-[14px] leading-snug ${TONE[tone]} ${animate ? "motion-safe:animate-gq-fade-up" : ""} ${className ?? ""}`}
    >
      <span className="mt-0.5 shrink-0">
        {tone === "success" ? <CheckIcon size={18} /> : <WarnIcon size={18} className="text-[var(--rs-warn-icon)]" />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className={`-my-1 inline-flex min-h-[44px] shrink-0 items-center px-2 font-semibold underline-offset-4 hover:underline ${FOCUS}`}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
