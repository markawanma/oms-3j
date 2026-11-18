"use client";

// OwnSlotBar — แถบเลือก "เม็ดที่จะแก้" 1..N ซ้าย→ขวา (D1.2a A2/A10) · radiogroup เลือกได้เม็ดเดียว · roving tabindex ←→ (handleRadioKeyDown)
// ช่อง ≥45×64 ที่ 360px (7 เม็ด) · ต่ำกว่า 340px แตกเป็น 2 แถว (บนลงล่าง ซ้ายไปขวา) ไม่ลดต่ำกว่า 44 · 3–4 เม็ดไม่ยืดเต็มกว้าง
// ไม่พึ่งสี: เลข + ขอบ 2px + แถบล่าง 3px · ชื่อพลอยอยู่ใน aria-label / หัวเม็ด / สรุป (ไม่ใส่ในช่อง — ไม่ตั้งชื่อย่อเอง)
// grid ใช้ CSS variable (--n/--wrap) ผ่าน style — class ไดนามิกของ Tailwind ไม่ทำงานเพราะไม่ถูก scan
import type { CSSProperties } from "react";
import { useRef } from "react";
import { GEM_QUIZ_STONE_BY_CODE, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import { GemIcon } from "../../gem-quiz/_components/GemIcon";
import { handleRadioKeyDown } from "./radio-keys";

export function OwnSlotBar({
  codes,
  selected,
  onSelect,
}: {
  /** null = ยังไม่เลือก (วงเส้นประ) · ความยาว = จำนวนเม็ด */
  codes: readonly (GemQuizStoneCode | null)[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const n = codes.length;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const style = { "--n": n, "--wrap": n >= 5 ? Math.ceil(n / 2) : n } as CSSProperties;
  return (
    <div
      role="radiogroup"
      aria-label={SHOWCASE_COPY.ownSlotBarLabel}
      style={style}
      className="mx-auto grid w-full max-w-[calc(var(--n)*88px)] grid-cols-[repeat(var(--n),minmax(0,1fr))] gap-0.5 max-[339px]:grid-cols-[repeat(var(--wrap),minmax(0,1fr))] sm:gap-1.5"
    >
      {codes.map((code, i) => {
        const checked = i === selected;
        const stone = code ? GEM_QUIZ_STONE_BY_CODE[code] : null;
        return (
          <button
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={SHOWCASE_COPY.ownSlotAria(i + 1, stone ? stone.labelTh : null)}
            tabIndex={checked ? 0 : -1}
            onClick={() => onSelect(i)}
            onKeyDown={(e) =>
              handleRadioKeyDown(e, i, n, (next) => {
                onSelect(next);
                refs.current[next]?.focus();
              })
            }
            className={`relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border px-0.5 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)] ${
              checked ? "border-2 border-[var(--gq-burgundy)] bg-[var(--gq-burgundy-soft)]" : "border-[var(--gq-border)] bg-white hover:border-[var(--gq-burgundy-border)]"
            }`}
          >
            {stone ? (
              <GemIcon colors={stone.colors} size={22} />
            ) : (
              <span aria-hidden="true" className="h-[22px] w-[22px] rounded-full border border-dashed border-[var(--gq-text-muted)]" />
            )}
            <span aria-hidden="true" className="text-[15px] font-bold leading-none text-[var(--gq-text)]">
              {i + 1}
            </span>
            {checked && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--gq-burgundy)]" />}
          </button>
        );
      })}
    </div>
  );
}
