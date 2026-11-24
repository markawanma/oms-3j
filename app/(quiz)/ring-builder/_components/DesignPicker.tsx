"use client";

// DesignPicker — "เลือกแบบแหวน" 7 แบบ (UX D1.2 §2.2): radiogroup เลื่อนแนวนอนบนมือถือ (เห็นใบที่ 4 โผล่ครึ่งใบ = ปัดได้) · grid 4 คอลัมน์บนเดสก์ท็อป
// chip = pictogram (ตำแหน่งเม็ด · ทึบ=หลัก กลวง=เสริม) + ชื่อสั้น + ราคาของแบบ (D1.3 · ราคาไม่เท่ากันทุกแบบ ลูกค้าต้องเห็นก่อนกด) · ห้ามใช้รูปถ่าย/ภาพ 3D เป็น thumbnail (มีรูปจริงแค่ไขว้ · Z6) · ชื่อมาจาก designs.ts เท่านั้น
// a11y: roving tabindex (tab stop = ใบที่เลือก) · ←→↑↓ Home End ผ่าน handleRadioKeyDown + scrollIntoView · เลือกแล้ว = ขอบ 2px + เครื่องหมายถูก (ไม่พึ่งสี)
import { useId, useRef } from "react";
import { DESIGNS, type ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";
import { SHOWCASE_COPY, formatPriceThb } from "@/lib/ring-builder/showcase/config";
import { DesignPictogram } from "./DesignPictogram";
import { handleRadioKeyDown } from "./radio-keys";

export function DesignPicker({ value, onChange }: { value: ShowcaseDesignId; onChange: (id: ShowcaseDesignId) => void }) {
  const headingId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIdx = Math.max(
    0,
    DESIGNS.findIndex((d) => d.id === value)
  );

  function focusAndScroll(i: number) {
    const el = refs.current[i];
    if (!el) return;
    el.focus();
    // reduced-motion: เบราว์เซอร์ใช้ behavior=auto อยู่แล้ว (ไม่ตั้ง smooth)
    el.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="font-quiz-serif text-xl font-semibold text-[var(--gq-burgundy-dark)]">
          {SHOWCASE_COPY.designHeading}
        </h2>
        <span className="text-xs text-[var(--gq-text-muted)] lg:hidden">{SHOWCASE_COPY.designHint(DESIGNS.length)}</span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        className="-mx-4 flex snap-x gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {DESIGNS.map((design, i) => {
          const checked = design.id === value;
          return (
            <button
              key={design.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${design.name} ${formatPriceThb(design.id)}`}
              tabIndex={i === selectedIdx ? 0 : -1}
              onClick={() => onChange(design.id)}
              onKeyDown={(e) =>
                handleRadioKeyDown(e, i, DESIGNS.length, (next) => {
                  onChange(DESIGNS[next].id);
                  focusAndScroll(next);
                })
              }
              className={`relative flex h-[88px] min-w-[104px] flex-none snap-start flex-col items-center justify-center gap-1 rounded-xl border px-2 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)] lg:min-w-0 ${
                checked
                  ? "border-2 border-[var(--gq-burgundy)] bg-[var(--gq-burgundy-soft)] text-[var(--gq-burgundy-dark)]"
                  : "border-[var(--gq-border)] bg-white text-[var(--gq-text)] hover:border-[var(--gq-burgundy-border)]"
              }`}
            >
              <DesignPictogram design={design} className="h-8 w-12 text-[var(--gq-burgundy)]" />
              <span aria-hidden="true" className="whitespace-nowrap text-sm leading-none">
                {design.shortName}
              </span>
              <span aria-hidden="true" className="whitespace-nowrap text-xs leading-none text-[var(--gq-text-muted)]">
                {formatPriceThb(design.id)}
              </span>
              {checked && (
                <span aria-hidden="true" className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--gq-burgundy)] text-white">
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
