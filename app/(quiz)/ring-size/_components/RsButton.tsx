import type { ReactNode } from "react";
import { cx, FOCUS } from "./styles";

// RsButton — ปุ่มหลัก/รอง ≥ 56 px มุม 16 (ไม่ reuse PrimaryButton ของ gem quiz: รูปร่างต่าง + สีปิดใช้งานคอนทราสต์ต่ำ + ห้ามแตะ)
//
// กติกา:
//   - ปิดใช้งาน = <button disabled> เสมอ (กดด้วยคีย์บอร์ดไม่ได้) — ห้าม <a aria-disabled>
//   - ปุ่มปิดต้องมีเหตุผลเป็นข้อความบนปุ่ม (ผู้เรียกส่งเป็น children) · สีตัวหนังปิดใช้งาน #675A56 บน #E5D9D3 ≥ 4.5:1
//   - href + ไม่ปิด = <a> (ลิงก์ปกติหน้าเดิม — webview บล็อก window.open)

const BASE =
  "inline-flex w-full min-h-[56px] items-center justify-center gap-2.5 rounded-[var(--rs-radius-btn)] px-5 text-center text-[18px] font-semibold leading-snug transition-colors " +
  FOCUS;

const PRIMARY =
  "bg-[var(--rs-brand)] text-white shadow-[0_8px_20px_rgba(162,25,29,0.22)] hover:bg-[var(--rs-brand-hover)] active:bg-[var(--rs-brand-hover)]";
const SECONDARY =
  "border-[1.5px] border-[var(--rs-border-btn-2)] bg-[var(--rs-surface)] text-[var(--rs-text)] text-[16px] font-medium min-h-[52px] hover:border-[var(--rs-brand)]";
const DISABLED = "cursor-not-allowed bg-[var(--rs-disabled-bg)] text-[var(--rs-disabled-text)] shadow-none";

export function RsButton({
  children,
  variant = "primary",
  href,
  onClick,
  disabled = false,
  icon,
  type = "button",
  className,
  "aria-busy": ariaBusy,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary";
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  type?: "button" | "submit";
  className?: string;
  "aria-busy"?: boolean;
}) {
  const cls = cx(BASE, disabled ? DISABLED : variant === "primary" ? PRIMARY : SECONDARY, className);
  if (href && !disabled) {
    return (
      <a href={href} onClick={onClick} className={cls} rel="noopener">
        {icon}
        {children}
      </a>
    );
  }
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={cls} aria-busy={ariaBusy}>
      {icon}
      {children}
    </button>
  );
}
