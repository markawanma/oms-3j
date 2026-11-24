import type { MouseEvent, ReactNode } from "react";
import { HUB_URL } from "@/lib/site/hosts";

// ToolsHubLink — ทางกลับหน้ารวมเครื่องมือ (ux-tools-hub §4 · P3 · ux-tools-navigation §2/§16)
// server-safe (ไม่มี state/"use server"/env) · <a href> ธรรมดา: ไม่ใช้ next/link (header XFO/CSP/Permissions-Policy ติดเฉพาะตอนโหลดหน้าเต็ม) · ไม่ target=_blank (LINE in-app browser กลับยาก)
// มติเจ้าของ 24 พ.ย. 69 (เขียนทับมติ 18 พ.ย. ที่ห้ามวางกลางทาง): วางได้ทุกจอ — แต่จอที่มีงานค้างต้องห่อด้วย ToolsHubExit (ถามยืนยันก่อนออก)
//   variant "text": ข้อความเล็ก "← เครื่องมือ 3J" (ขั้นแรกของ flow · ซ้ายบน · ring-builder)
//   variant "nav":  ขวาบนของหัวจอ — ไอคอนบ้าน + "เครื่องมือ 3J" (ทุกจอที่มีขั้นถอย) · รูปร่าง+ข้อความ ไม่พึ่งสีอย่างเดียว
//   variant "back": ข้อความ "← กลับหน้าเครื่องมือ" ท้ายหน้าจบ (ผลวัดไซซ์/ผล quiz)
//   variant "mark": ห่อโลโก้/มาร์กที่มีอยู่แล้ว (children) ให้กดกลับได้ — target ≥ 44×44 · aria-label ชัด
// onClick: ให้ ToolsHubExit (client) ดักตอนมีงานค้าง — ถ้าไม่ส่งก็เป็นลิงก์ล้วนที่ทำงานแม้ JS ไม่โหลด
const LABEL = "เครื่องมือ 3J";
const BACK_LABEL = "กลับหน้าเครื่องมือ";
const ARIA_MARK = "กลับหน้าเครื่องมือ 3J";
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy,#a2191d)]";
// สีข้อความรอง: quiz ใช้ --gq-text-muted · ring-size ใช้ --rs-text-2 · ไม่มีทั้งคู่ = เทา #6b6b6b (≥ 4.5:1 บนพื้นอ่อน)
const MUTED = "text-[var(--gq-text-muted,var(--rs-text-2,#6b6b6b))] hover:text-[var(--gq-burgundy-dark,var(--rs-brand-hover,#7d1216))]";

export type ToolsHubLinkVariant = "text" | "mark" | "nav" | "back";

export function ToolsHubLink({
  variant,
  children,
  className = "",
  onClick,
}: {
  variant: ToolsHubLinkVariant;
  children?: ReactNode;
  className?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (variant === "mark") {
    return (
      <a href={HUB_URL} aria-label={ARIA_MARK} onClick={onClick} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md ${FOCUS} ${className}`}>
        {children}
      </a>
    );
  }
  if (variant === "nav") {
    return (
      <a
        href={HUB_URL}
        aria-label={ARIA_MARK}
        onClick={onClick}
        className={`inline-flex min-h-11 min-w-11 items-center justify-end gap-1.5 px-2 text-right text-[13px] leading-tight underline-offset-4 hover:underline ${MUTED} ${FOCUS} ${className}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
          <path d="M3.5 11.5 12 4l8.5 7.5" />
          <path d="M6 10v9.5h4.5V14h3v5.5H18V10" />
        </svg>
        <span>{LABEL}</span>
      </a>
    );
  }
  return (
    <a
      href={HUB_URL}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1 text-sm underline-offset-4 hover:underline ${MUTED} ${FOCUS} ${className}`}
    >
      <span aria-hidden="true">←</span>
      {variant === "back" ? BACK_LABEL : LABEL}
    </a>
  );
}
