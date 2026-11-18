"use client";

// ModeSwitch — สวิตช์โหมด "แบบแนะนำ" | "เลือกพลอยเอง" (radiogroup 2 ปุ่มเต็มกว้าง สูง 48px · UX D1.1)
// เลือกจุดนี้ไม่ใช่การ์ดที่ 4 — การ์ดที่ 4 + แผง picker จะดันไซซ์ลงเกินจอ ขณะ stage กิน 40% · สลับโหมดไม่ล้างค่าอีกฝั่ง (state อยู่ที่แม่)
import { useRef } from "react";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import { handleRadioKeyDown } from "./radio-keys";

export type ShowcaseMode = "rec" | "own";
const OPTIONS: readonly { mode: ShowcaseMode; label: string }[] = [
  { mode: "rec", label: SHOWCASE_COPY.modeRecommended },
  { mode: "own", label: SHOWCASE_COPY.modeOwn },
];

export function ModeSwitch({ mode, onChange }: { mode: ShowcaseMode; onChange: (mode: ShowcaseMode) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="radiogroup" aria-label={SHOWCASE_COPY.modeLabel} className="grid grid-cols-2 gap-1.5 rounded-full border border-[var(--gq-border)] bg-white p-1">
      {OPTIONS.map((o, i) => {
        const checked = o.mode === mode;
        return (
          <button
            key={o.mode}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(o.mode)}
            onKeyDown={(e) =>
              handleRadioKeyDown(e, i, OPTIONS.length, (next) => {
                onChange(OPTIONS[next].mode);
                refs.current[next]?.focus();
              })
            }
            className={`min-h-12 rounded-full px-3 text-[15px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)] ${
              checked ? "bg-[var(--gq-burgundy)] text-white" : "text-[var(--gq-text)] hover:bg-[var(--gq-burgundy-soft)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
