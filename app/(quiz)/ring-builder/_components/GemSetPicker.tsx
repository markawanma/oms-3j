"use client";

// GemSetPicker — "พลอยที่คุณเลือกได้": แบบ 1/2/3 (พลอยอันดับ 1–3 จาก quiz) เป็น radiogroup การ์ดแนวตั้ง
// เข้าตรง (ไม่มี g) = การ์ดชวนทำ quiz แทน (ไม่มีตัวเลือกพลอยรายเม็ด — มติ TL §7b)
// ข้อความอธิบายคู่พลอย = GEM_QUIZ_PAIRS คำต่อคำ (title / th / "เหมาะกับ: fit") · ไม่แต่งสรรพคุณใหม่ (X7)
import { useId, useRef } from "react";
import { GEM_QUIZ_STONE_BY_CODE } from "@/lib/gem-quiz/config";
import { GEM_QUIZ_PATH, SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import type { ShowcaseSet } from "@/lib/ring-builder/showcase/sets";
import { GemIcon } from "../../gem-quiz/_components/GemIcon";
import { handleRadioKeyDown } from "./radio-keys";

export function GemSetPicker({
  sets,
  selectedIndex,
  onSelect,
}: {
  /** null = เข้าตรง/param เสีย */
  sets: readonly ShowcaseSet[] | null;
  selectedIndex: 1 | 2 | 3;
  onSelect: (index: 1 | 2 | 3) => void;
}) {
  const headingId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  if (!sets) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="font-quiz-serif text-xl font-semibold text-[var(--gq-burgundy-dark)]">{SHOWCASE_COPY.pickerHeading}</h2>
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-[var(--gq-burgundy-border)] bg-[var(--gq-burgundy-soft)] p-4">
          <p className="font-quiz-serif text-lg font-semibold text-[var(--gq-burgundy-dark)]">{SHOWCASE_COPY.quizCardTitle}</p>
          <p className="text-sm text-[var(--gq-text-muted)]">{SHOWCASE_COPY.quizCardNote}</p>
          <a
            href={GEM_QUIZ_PATH}
            className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-[var(--gq-burgundy)] px-6 text-base font-medium text-white transition-colors hover:bg-[var(--gq-burgundy-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
          >
            {SHOWCASE_COPY.quizCardCta}
          </a>
        </div>
      </div>
    );
  }

  const selected = sets.find((s) => s.index === selectedIndex) ?? sets[0];

  return (
    <div className="flex flex-col gap-3">
      <h2 id={headingId} className="font-quiz-serif text-xl font-semibold text-[var(--gq-burgundy-dark)]">
        {SHOWCASE_COPY.pickerHeading}
      </h2>
      <div role="radiogroup" aria-labelledby={headingId} className="flex flex-col gap-2.5">
        {sets.map((set, i) => {
          const checked = set.index === selected.index;
          const topStone = GEM_QUIZ_STONE_BY_CODE[set.top];
          const bottomStone = GEM_QUIZ_STONE_BY_CODE[set.bottom];
          return (
            <button
              key={set.index}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onSelect(set.index)}
              onKeyDown={(e) =>
                handleRadioKeyDown(e, i, sets.length, (next) => {
                  onSelect(sets[next].index);
                  refs.current[next]?.focus();
                })
              }
              className={`relative flex min-h-[84px] w-full items-center gap-3.5 rounded-2xl border px-3.5 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)] ${
                checked
                  ? "border-[var(--gq-burgundy)] bg-[var(--gq-burgundy-soft)]"
                  : "border-[var(--gq-border)] bg-white hover:border-[var(--gq-burgundy-border)]"
              }`}
            >
              <span className="flex flex-none items-center gap-1" aria-hidden="true">
                <GemIcon colors={topStone.colors} size={40} />
                <GemIcon colors={bottomStone.colors} size={32} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs tracking-[0.08em] text-[var(--gq-burgundy)]">
                  แบบ {set.index} · {SHOWCASE_COPY.rankBadge(set.index)}
                </span>
                <span className="text-base font-medium text-[var(--gq-text)]">
                  {topStone.labelTh} + {bottomStone.labelTh}
                </span>
                {set.sameAsIndex !== null && (
                  <span className="text-[13px] text-[var(--gq-text-muted)]">{SHOWCASE_COPY.sameAs(set.sameAsIndex)}</span>
                )}
              </span>
              {/* เครื่องหมายถูก — ไม่พึ่งสี/ขอบอย่างเดียว */}
              {checked && (
                <span aria-hidden="true" className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[var(--gq-burgundy)] text-white">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="flex flex-col gap-1.5 rounded-2xl border border-[var(--gq-border-soft)] bg-white px-4 py-3.5">
        <p className="font-quiz-display text-xl font-semibold text-[var(--gq-burgundy-dark)]">{selected.pair.title}</p>
        <p className="text-[13px] text-[var(--gq-text-muted)]">{selected.pair.th}</p>
        <p className="text-sm">เหมาะกับ: {selected.pair.fit}</p>
        <p className="mt-1 text-xs leading-[1.6] text-[var(--gq-text-muted)]">{SHOWCASE_COPY.pickerBasisNote}</p>
      </div>
    </div>
  );
}
