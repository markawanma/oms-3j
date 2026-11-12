"use client";

// SizePicker — "เลือกไซซ์" 55–58 (radiogroup · ปุ่ม 48×48 เว้น 8) + ลิงก์ไป /ring-size + ผลวัดล่าสุด (เสนอให้ ไม่เลือกให้)
// ไม่เลือก = ปุ่ม LINE ยังกดได้ (OrderSummary แสดงแถบเตือน) — ปุ่ม "ให้แอดมินช่วยเช็กไซซ์" ล้างค่าเพื่อให้ย้อนกลับได้
import { useId, useRef } from "react";
import { fitsDesignRange, type LastMeasuredSize } from "@/lib/ring-builder/last-size";
import { RING_SIZE_PATH, SHOWCASE_COPY, SHOWCASE_SIZES, SHOWCASE_SIZE_RANGE } from "@/lib/ring-builder/showcase/config";
import { handleRadioKeyDown } from "./radio-keys";

export function SizePicker({
  value,
  onChange,
  lastMeasured,
}: {
  value: number | null;
  onChange: (size: number | null) => void;
  /** ผลวัดล่าสุดจาก /ring-size (อ่านใน client หลัง mount) */
  lastMeasured: LastMeasuredSize | null;
}) {
  const headingId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabStop = value === null ? 0 : SHOWCASE_SIZES.indexOf(value as (typeof SHOWCASE_SIZES)[number]);
  const lastFits = lastMeasured ? fitsDesignRange(lastMeasured.size, { sizeMin: SHOWCASE_SIZE_RANGE.min, sizeMax: SHOWCASE_SIZE_RANGE.max }) : false;

  return (
    <div className="flex flex-col gap-3">
      <h2 id={headingId} className="font-quiz-serif text-xl font-semibold text-[var(--gq-burgundy-dark)]">
        {SHOWCASE_COPY.sizeHeading}
      </h2>
      <div role="radiogroup" aria-labelledby={headingId} className="flex flex-wrap gap-2">
        {SHOWCASE_SIZES.map((size, i) => {
          const checked = value === size;
          return (
            <button
              key={size}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={SHOWCASE_COPY.sizeUnit(size)}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => onChange(size)}
              onKeyDown={(e) =>
                handleRadioKeyDown(e, i, SHOWCASE_SIZES.length, (next) => {
                  onChange(SHOWCASE_SIZES[next]);
                  refs.current[next]?.focus();
                })
              }
              className={`inline-flex h-12 w-12 items-center justify-center rounded-full border text-base font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)] ${
                checked
                  ? "border-[var(--gq-burgundy)] bg-[var(--gq-burgundy)] text-white"
                  : "border-[var(--gq-border)] bg-white text-[var(--gq-text)] hover:border-[var(--gq-burgundy-border)]"
              }`}
            >
              {size}
            </button>
          );
        })}
      </div>

      {value !== null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="inline-flex min-h-11 w-fit items-center text-sm text-[var(--gq-text-muted)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
        >
          {`ล้างไซซ์ — ${SHOWCASE_COPY.sizePending}`}
        </button>
      )}

      {lastMeasured && (
        <div className="flex flex-col items-start gap-1 rounded-xl border border-[var(--gq-border-soft)] bg-white px-3.5 py-3 text-sm">
          <p>{SHOWCASE_COPY.lastMeasured(lastMeasured.size)}</p>
          {lastFits ? (
            value !== lastMeasured.size && (
              <button
                type="button"
                onClick={() => onChange(lastMeasured.size)}
                className="inline-flex min-h-11 items-center rounded-full border border-[var(--gq-burgundy-border)] px-4 text-sm font-medium text-[var(--gq-burgundy)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
              >
                {SHOWCASE_COPY.useLastMeasured(lastMeasured.size)}
              </button>
            )
          ) : (
            <p className="text-[var(--gq-text-muted)]">{SHOWCASE_COPY.lastMeasuredOutOfRange}</p>
          )}
        </div>
      )}

      <a
        href={RING_SIZE_PATH}
        className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-[var(--gq-burgundy)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
      >
        {SHOWCASE_COPY.sizeHelp}
      </a>
    </div>
  );
}
