import type { ReactNode } from "react";
import type { HubTool } from "@/lib/tools-hub/config";

// ToolCard — การ์ดลิงก์ 1 เครื่องมือ · <a> ทั้งการ์ด (ไม่ใช่ div onClick) · ห้าม next/link (design-tools-hub §1.3: header ติดเฉพาะตอนโหลดหน้าเต็ม)
// primary = พื้น burgundy ตัวขาว (ปุ่มหลักเดียวของหน้า) · outline = พื้นขาวขอบอ่อน
// children = chip ผลวัดล่าสุด (ข้อความธรรมดาในการ์ดเดียวกัน)
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]";

function Icon({ id }: { id: HubTool["id"] }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;
  if (id === "ring-builder")
    return (
      <svg {...common}>
        <circle cx="12" cy="15" r="6" />
        <path d="M9.5 6.5 12 3l2.5 3.5L12 9z" />
      </svg>
    );
  if (id === "gem-quiz")
    return (
      <svg {...common}>
        <path d="M6 4h12l3 5-9 11L3 9z" />
        <path d="M3 9h18M9 4l-1 5 4 11 4-11-1-5" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="8" width="18" height="8" rx="1.5" />
      <path d="M7 8v3M11 8v4M15 8v3M19 8v4" />
    </svg>
  );
}

export function ToolCard({ tool, children }: { tool: HubTool; children?: ReactNode }) {
  const primary = tool.variant === "primary";
  return (
    <li>
      <a
        href={tool.href}
        className={`group block min-h-[96px] rounded-2xl border p-4 transition-colors ${FOCUS} ${
          primary
            ? "border-[var(--gq-burgundy)] bg-[var(--gq-burgundy)] text-white hover:bg-[var(--gq-burgundy-dark)]"
            : "border-[var(--gq-border)] bg-white text-[var(--gq-text)] hover:border-[var(--gq-burgundy-border)] hover:bg-[var(--gq-burgundy-soft)]"
        }`}
      >
        <div className="flex items-start gap-3">
          <span className={primary ? "text-white" : "text-[var(--gq-burgundy)]"}>
            <Icon id={tool.id} />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className={`font-quiz-serif text-[18px] font-semibold leading-snug [overflow-wrap:anywhere] ${
                primary ? "text-white" : "text-[var(--gq-burgundy-dark)]"
              }`}
            >
              {tool.title}
            </h2>
            <p className={`mt-1 text-[14px] leading-relaxed [overflow-wrap:anywhere] ${primary ? "text-white/90" : "text-[var(--gq-text-muted)]"}`}>
              {tool.description}
            </p>
            <p
              className={`mt-2 inline-block rounded-full px-3 py-1 text-[12px] leading-snug ${
                primary ? "bg-white text-[var(--gq-burgundy-dark)]" : "bg-[var(--gq-burgundy-soft)] text-[var(--gq-burgundy-dark)]"
              }`}
            >
              {tool.meta}
            </p>
            {children}
          </div>
          <span aria-hidden="true" className="mt-1 text-xl motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5">
            →
          </span>
        </div>
        <span className="sr-only">{tool.cta}</span>
      </a>
    </li>
  );
}
