// PrimaryButton — ปุ่ม pill หลักของแบบทดสอบ (landing CTA / "ถัดไป" /
// ผลลัพธ์ CTA / "ทำแบบทดสอบใหม่"). พอร์ตสไตล์จาก .cta/.opt ของ Quiz.dc.html.
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-[var(--gq-burgundy)] text-white hover:bg-[var(--gq-burgundy-dark)] disabled:bg-zinc-200 disabled:text-zinc-400",
  secondary: "border border-[var(--gq-border)] bg-white text-[var(--gq-text)] hover:bg-[var(--gq-burgundy-soft)] disabled:text-zinc-400",
};

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** แสดงลูกศรขวา (ท้ายปุ่ม) — ใช้กับ "เริ่มทำแบบทดสอบ"/"ถัดไป" ตาม mockup */
  trailingArrow?: boolean;
  children: ReactNode;
}

export function PrimaryButton({ variant = "primary", trailingArrow = false, className = "", children, ...rest }: PrimaryButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full text-base font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
      {trailingArrow && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      )}
    </button>
  );
}
