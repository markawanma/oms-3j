"use client";

// SizePicker — "เลือกไซซ์" ตามช่วงของแบบแหวน (ไขว้ 55–58 · แบบแถว 50–60) · radiogroup grid 6 คอลัมน์ ปุ่ม ≥48 + ลิงก์ไป /ring-size + ผลวัดล่าสุด (เสนอให้ ไม่เลือกให้)
// ไม่เลือก = ปุ่ม LINE ยังกดได้ (OrderSummary แสดงแถบเตือน) — ปุ่ม "ล้างไซซ์" ล้างค่าเพื่อให้ย้อนกลับได้
// D1.2 (Z2): `value` = effectiveSize ที่ผู้เรียกคำนวณแล้ว (ไซซ์ดิบนอกช่วงของแบบ → null) · `outOfRangeSize` = ไซซ์ดิบที่ใช้กับแบบนี้ไม่ได้ → แถบบอกทันที (ไม่ลบค่า · สลับกลับแล้วกลับมาเอง)
import { useId, useRef } from "react";
import { fitsDesignRange, type LastMeasuredSize } from "@/lib/ring-builder/last-size";
import { RING_SIZE_PATH, SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import type { ShowcaseDesign } from "@/lib/ring-builder/showcase/designs";
import { handleRadioKeyDown } from "./radio-keys";

export function SizePicker({
  design,
  value,
  outOfRangeSize,
  onChange,
  lastMeasured,
}: {
  design: ShowcaseDesign;
  /** effectiveSize — null = ยังไม่เลือก (หรือไซซ์ที่เลือกไว้ใช้กับแบบนี้ไม่ได้) */
  value: number | null;
  /** ไซซ์ดิบที่เลือกไว้แต่นอกช่วงของแบบนี้ (null = ไม่มี) */
  outOfRangeSize: number | null;
  onChange: (size: number | null) => void;
  /** ผลวัดล่าสุดจาก /ring-size (อ่านใน client หลัง mount) */
  lastMeasured: LastMeasuredSize | null;
}) {
  const headingId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const sizes = design.sizes;
  const min = sizes[0];
  const max = sizes[sizes.length - 1];
  const tabStop = value === null ? 0 : Math.max(0, sizes.indexOf(value));
  const lastFits = lastMeasured ? fitsDesignRange(lastMeasured.size, { sizeMin: min, sizeMax: max }) : false;

  return (
    <div className="flex flex-col gap-3">
      <h2 id={headingId} className="font-quiz-serif text-xl font-semibold text-[var(--gq-burgundy-dark)]">
        {SHOWCASE_COPY.sizeHeading} <span className="text-base font-normal text-[var(--gq-text-muted)]">({SHOWCASE_COPY.sizeRange(min, max)})</span>
      </h2>
      <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-6 gap-2">
        {sizes.map((size, i) => {
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
                handleRadioKeyDown(e, i, sizes.length, (next) => {
                  onChange(sizes[next]);
                  refs.current[next]?.focus();
                })
              }
              className={`inline-flex h-12 min-w-12 items-center justify-center rounded-full border text-base font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)] ${
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

      {outOfRangeSize !== null && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm leading-[1.55] text-amber-900">
          <svg className="mt-0.5 flex-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.2v.1" />
          </svg>
          <span>{SHOWCASE_COPY.sizeOutOfRangeNote(outOfRangeSize, min, max)}</span>
        </p>
      )}

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
