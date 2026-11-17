"use client";

// OwnGemPicker — แผงโหมด "เลือกพลอยเอง": 2 แถว radiogroup (พลอยบน/พลอยล่าง) × 5 ชนิดเดิม · บน=ล่างได้ (25 แบบ) · ราคาไม่เปลี่ยน (800 บาทที่เดียว)
// 🔴 คำอธิบายมาจาก config เท่านั้น: คู่ตรงใน GEM_QUIZ_PAIRS (findExactPair) → ข้อความคู่เดิม · ไม่มีคู่ → labelTh + keywords รายเม็ด + หมายเหตุ · ไม่มีคำเชื่อมความหมายเอง (Y4)
// ปุ่ม 5 ต่อแถวที่ 360px ≈ 59×64px · เลือกแล้ว = ขอบหนา + เครื่องหมายถูก (ไม่พึ่งสี) · ←→ roving ต่อแถว
import { useId, useRef } from "react";
import { GEM_QUIZ_STONES, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import type { OwnGems } from "@/lib/ring-builder/showcase/quiz-link";
import { describeOwn } from "@/lib/ring-builder/showcase/sets";
import { GemIcon } from "../../gem-quiz/_components/GemIcon";
import { handleRadioKeyDown } from "./radio-keys";

function GemRow({
  label,
  value,
  onPick,
}: {
  label: string;
  value: GemQuizStoneCode | null;
  onPick: (code: GemQuizStoneCode) => void;
}) {
  const headingId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIdx = value === null ? -1 : GEM_QUIZ_STONES.findIndex((s) => s.code === value);
  const tabStop = selectedIdx < 0 ? 0 : selectedIdx;
  return (
    <div className="flex flex-col gap-2">
      <h3 id={headingId} className="text-[15px] font-medium text-[var(--gq-text)]">
        {label}
      </h3>
      <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-5 gap-2">
        {GEM_QUIZ_STONES.map((stone, i) => {
          const checked = stone.code === value;
          return (
            <button
              key={stone.code}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={stone.labelTh}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => onPick(stone.code)}
              onKeyDown={(e) =>
                handleRadioKeyDown(e, i, GEM_QUIZ_STONES.length, (next) => {
                  onPick(GEM_QUIZ_STONES[next].code);
                  refs.current[next]?.focus();
                })
              }
              className={`relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-0.5 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)] ${
                checked ? "border-2 border-[var(--gq-burgundy)] bg-[var(--gq-burgundy-soft)]" : "border-[var(--gq-border)] bg-white hover:border-[var(--gq-burgundy-border)]"
              }`}
            >
              <GemIcon colors={stone.colors} size={28} />
              <span aria-hidden="true" className="max-w-full whitespace-nowrap text-xs leading-none text-[var(--gq-text)]">
                {stone.labelTh}
              </span>
              {checked && (
                <span aria-hidden="true" className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--gq-burgundy)] text-white">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function OwnGemPicker({
  own,
  onPickTop,
  onPickBottom,
}: {
  /** null = ยังไม่ได้เลือกเลย (เข้าตรง) */
  own: OwnGems | null;
  onPickTop: (code: GemQuizStoneCode) => void;
  onPickBottom: (code: GemQuizStoneCode) => void;
}) {
  const desc = own ? describeOwn(own.top, own.bottom) : null;
  return (
    <div className="flex flex-col gap-4">
      <GemRow label={SHOWCASE_COPY.ownTopLabel} value={own ? own.top : null} onPick={onPickTop} />
      <GemRow label={SHOWCASE_COPY.ownBottomLabel} value={own ? own.bottom : null} onPick={onPickBottom} />

      <div aria-live="polite" className="flex flex-col gap-1.5 rounded-2xl border border-[var(--gq-border-soft)] bg-white px-4 py-3.5">
        {desc === null && <p className="text-sm text-[var(--gq-text-muted)]">{SHOWCASE_COPY.ownEmptyHint}</p>}
        {desc?.kind === "pair" && (
          <>
            <p className="font-quiz-display text-xl font-semibold text-[var(--gq-burgundy-dark)]">{desc.pair.title}</p>
            <p className="text-[13px] text-[var(--gq-text-muted)]">{desc.pair.th}</p>
            <p className="text-sm">เหมาะกับ: {desc.pair.fit}</p>
          </>
        )}
        {desc?.kind === "same" && (
          <>
            <p className="text-base font-medium text-[var(--gq-burgundy-dark)]">{SHOWCASE_COPY.ownBothSame(desc.label)}</p>
            <p className="text-sm text-[var(--gq-text-muted)]">{desc.keywords}</p>
          </>
        )}
        {desc?.kind === "singles" && (
          <>
            <p className="text-sm">
              <span className="font-medium text-[var(--gq-burgundy-dark)]">{desc.top.label}</span> · {desc.top.keywords}
            </p>
            <p className="text-sm">
              <span className="font-medium text-[var(--gq-burgundy-dark)]">{desc.bottom.label}</span> · {desc.bottom.keywords}
            </p>
            <p className="mt-1 text-xs leading-[1.6] text-[var(--gq-text-muted)]">{SHOWCASE_COPY.ownNoPairNote}</p>
          </>
        )}
      </div>
    </div>
  );
}
