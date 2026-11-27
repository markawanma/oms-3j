"use client";

// IntentionPicker — แถว "อยากเสริมเรื่องไหน" (แผงโหมดแบบแนะนำ · UX D1.1)
// มีเรื่องแล้ว = แถวเดียวสูง 48px "เรื่องที่เลือก: {เรื่อง}" + "เปลี่ยน" (aria-expanded) กางเป็น grid 2 คอลัมน์ 6 ปุ่ม · เลือกแล้วพับ
// ยังไม่มีเรื่อง (เข้าตรง) = กางไว้เลย · ชื่อเรื่องมาจาก GEM_QUIZ_QUESTIONS (ไม่แต่งเอง) · ไม่ fetch ไม่เปลี่ยน URL เอง (แม่เป็นคนเขียน)
import { useId, useRef, useState } from "react";
import { GEM_QUIZ_QUESTIONS, type GemQuizIntention } from "@/lib/gem-quiz/config";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import { INTENTION_CODES } from "@/lib/ring-builder/showcase/quiz-link";
import { handleRadioKeyDown } from "./radio-keys";

const INTENTION_QUESTION = GEM_QUIZ_QUESTIONS.find((q) => q.code === "intention");
const LABELS: Readonly<Record<string, string>> = Object.fromEntries((INTENTION_QUESTION?.options ?? []).map((o) => [o.code, o.labelTh]));

export function intentionLabel(code: GemQuizIntention): string {
  return Object.prototype.hasOwnProperty.call(LABELS, code) ? LABELS[code] : code;
}

export function IntentionPicker({ value, onSelect }: { value: GemQuizIntention | null; onSelect: (intention: GemQuizIntention) => void }) {
  const headingId = useId();
  const gridId = useId();
  const [open, setOpen] = useState(false); // เปิดเอง (กด "เปลี่ยน") — ตอนยังไม่มีเรื่องกางเสมอโดยไม่ต้องใช้ state นี้
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const expanded = value === null || open;
  const tabStop = value === null ? 0 : Math.max(0, INTENTION_CODES.indexOf(value));

  return (
    <div className="flex flex-col gap-2.5">
      <h2 id={headingId} data-jump="gems" tabIndex={-1} className="font-quiz-serif text-xl font-semibold text-[var(--gq-burgundy-dark)] focus:outline-none">
        {SHOWCASE_COPY.intentionHeading}
      </h2>

      {value !== null && (
        <div className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-[var(--gq-border-soft)] bg-white pl-4 pr-1.5">
          <span className="min-w-0 text-[15px]">{SHOWCASE_COPY.intentionChosen(intentionLabel(value))}</span>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={gridId}
            onClick={() => setOpen((v) => !v)}
            className="min-h-11 flex-none rounded-full px-4 text-sm font-medium text-[var(--gq-burgundy)] transition-colors hover:bg-[var(--gq-burgundy-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
          >
            {SHOWCASE_COPY.intentionChange}
          </button>
        </div>
      )}

      <div id={gridId} hidden={!expanded}>
        {expanded && (
          <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-2 gap-2">
            {INTENTION_CODES.map((code, i) => {
              const checked = code === value;
              return (
                <button
                  key={code}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={i === tabStop ? 0 : -1}
                  onClick={() => {
                    setOpen(false);
                    onSelect(code);
                  }}
                  onKeyDown={(e) =>
                    // ลูกศร = เลือก + โฟกัส (เหมือน radiogroup อื่น) แต่ยังไม่พับ — พับเฉพาะตอนกด/Enter เลือก
                    handleRadioKeyDown(e, i, INTENTION_CODES.length, (next) => {
                      onSelect(INTENTION_CODES[next]);
                      refs.current[next]?.focus();
                    })
                  }
                  className={`flex min-h-12 items-center justify-center rounded-2xl border px-2.5 py-2 text-center text-sm leading-snug transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)] ${
                    checked
                      ? "border-2 border-[var(--gq-burgundy)] bg-[var(--gq-burgundy-soft)] font-medium"
                      : "border-[var(--gq-border)] bg-white hover:border-[var(--gq-burgundy-border)]"
                  }`}
                >
                  {checked && (
                    <svg className="mr-1.5 flex-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                  {intentionLabel(code)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
