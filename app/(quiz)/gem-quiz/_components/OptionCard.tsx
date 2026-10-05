// OptionCard — ตัวเลือกคำถามแบบ single-select ของ Q1/Q2/Q3/Q5 (design §5).
// variant "list" = แถวเต็มความกว้าง (Q1 วันเกิด, Q5 "ยังไม่แน่ใจ"), variant
// "grid" = การ์ด 2 คอลัมน์ (Q2/Q3/Q5 ring-type) ตาม Quiz.dc.html.
//
// `<button>` จริง + aria-pressed (ไม่ใช้ input/label ซ่อน) ตามกฎ a11y ของ
// brief — ปุ่มสื่อสถานะด้วยทั้งสี/ขอบ "และ" เครื่องหมายถูก ไม่พึ่งสีอย่างเดียว.
import type { ReactNode } from "react";

function CheckBadge() {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[var(--gq-burgundy)] text-white"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

export function OptionCard({
  label,
  selected,
  onClick,
  disabled = false,
  variant,
  icon,
  className = "",
}: {
  label: ReactNode;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  variant: "list" | "grid";
  icon?: ReactNode;
  className?: string;
}) {
  const toneClasses = selected
    ? "border-[var(--gq-burgundy)] bg-[var(--gq-burgundy-soft)] text-[var(--gq-burgundy-dark)]"
    : "border-[var(--gq-border)] text-[var(--gq-text)] hover:border-[var(--gq-burgundy-border)]";

  if (variant === "grid") {
    return (
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onClick}
        className={`relative flex min-h-[112px] flex-col items-center justify-center gap-2.5 rounded-2xl border px-2.5 py-4 text-center text-sm leading-[1.45] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses} ${className}`}
      >
        {icon}
        <span>{label}</span>
        {selected && (
          <span className="absolute right-2 top-2">
            <CheckBadge />
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-14 w-full items-center gap-3.5 rounded-2xl border px-4 text-left text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses} ${className}`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {selected && <CheckBadge />}
    </button>
  );
}
