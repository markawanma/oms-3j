import type { ReactNode } from "react";
import { HUB_URL } from "@/lib/site/hosts";

// ToolsHubLink — ทางกลับหน้ารวมเครื่องมือ (ux-tools-hub §4 · P3)
// server-safe (ไม่มี state/"use server"/env) · <a href> ธรรมดา: ไม่ใช้ next/link (header XFO/CSP/Permissions-Policy ติดเฉพาะตอนโหลดหน้าเต็ม) · ไม่ target=_blank (LINE in-app browser กลับยาก)
// 🔴 วางเฉพาะจุดที่ยังไม่มี state ที่เสียได้ (ring-builder · quiz landing · ring-size หน้าแรก/หน้าผล) — ห้ามวางระหว่างทำ quiz/วัดไซซ์
//   variant "text": ข้อความเล็ก "← เครื่องมือ 3J" (ring-builder · quiz landing)
//   variant "mark": ห่อโลโก้/มาร์กที่มีอยู่แล้ว (children) ให้กดกลับได้ — target ≥ 44×44 · aria-label ชัด
const LABEL = "เครื่องมือ 3J";
const ARIA_MARK = "กลับหน้าเครื่องมือ 3J";
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy,#a2191d)]";

export function ToolsHubLink({ variant, children, className = "" }: { variant: "text" | "mark"; children?: ReactNode; className?: string }) {
  if (variant === "mark") {
    return (
      <a href={HUB_URL} aria-label={ARIA_MARK} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md ${FOCUS} ${className}`}>
        {children}
      </a>
    );
  }
  return (
    <a
      href={HUB_URL}
      className={`inline-flex min-h-11 items-center gap-1 text-sm text-[var(--gq-text-muted,#6b6b6b)] underline-offset-4 hover:text-[var(--gq-burgundy-dark,#7d1216)] hover:underline ${FOCUS} ${className}`}
    >
      <span aria-hidden="true">←</span>
      {LABEL}
    </a>
  );
}
