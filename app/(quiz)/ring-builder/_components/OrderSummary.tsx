"use client";

// OrderSummary — การ์ดสรุป + ปุ่มส่ง LINE (oaMessage · หลัก) + คัดลอกข้อความ (สำรอง) — ปุ่มอยู่ท้ายหน้า ไม่ติดล่างจอ
// 🔴 ไม่มีรหัส/QR/ฟอร์มข้อมูลส่วนบุคคล/ชำระเงิน · ลูกค้ากดส่งเองใน LINE · ข้อความแก้ได้ = ไม่ใช่หลักฐานราคา (แอดมินยืนยันเอง)
// ปุ่ม LINE เป็น <a> ธรรมดา ไม่ disabled เมื่อไม่มีไซซ์ (UX §6) — มีแถบเตือน (ไอคอน + ข้อความ ไม่พึ่งสีอย่างเดียว)
import { useEffect, useRef, useState } from "react";
import { SHOWCASE_COPY, SHOWCASE_DESIGN_NAME, formatPriceThb } from "@/lib/ring-builder/showcase/config";
import { copyText } from "@/lib/ring-builder/showcase/clipboard";
import { buildShowcaseLineHref, buildShowcaseLineMessage } from "@/lib/ring-builder/showcase/line-message";

const COPIED_MS = 3000;

export function OrderSummary({
  setIndex,
  topLabel,
  bottomLabel,
  size,
}: {
  setIndex: number | null;
  topLabel: string;
  bottomLabel: string;
  size: number | null;
}) {
  const input = { setIndex, topLabel, bottomLabel, size };
  const message = buildShowcaseLineMessage(input);
  const href = buildShowcaseLineHref(input);

  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  async function onCopy() {
    if (message === null) return;
    const ok = await copyText(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (ok) {
      setCopyFailed(false);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), COPIED_MS);
    } else {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  const rows: [string, string][] = [
    [SHOWCASE_COPY.summaryDesign, setIndex === null ? SHOWCASE_DESIGN_NAME : `${SHOWCASE_DESIGN_NAME} · แบบ ${setIndex}`],
    [SHOWCASE_COPY.summaryTop, topLabel],
    [SHOWCASE_COPY.summaryBottom, bottomLabel],
    [SHOWCASE_COPY.summarySize, size === null ? SHOWCASE_COPY.sizePending : SHOWCASE_COPY.sizeUnit(size)],
    [SHOWCASE_COPY.summaryPrice, formatPriceThb()],
  ];

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-quiz-serif text-xl font-semibold text-[var(--gq-burgundy-dark)]">{SHOWCASE_COPY.summaryHeading}</h2>
      <dl className="rounded-2xl border border-[var(--gq-border-soft)] bg-white px-4">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 border-b border-[var(--gq-divider)] py-3 last:border-b-0">
            <dt className="text-sm text-[var(--gq-text-muted)]">{k}</dt>
            <dd className="text-right text-[15px] font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-[var(--gq-text-muted)]">{SHOWCASE_COPY.notAnOrder}</p>

      {size === null && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm leading-[1.55] text-amber-900">
          <svg className="mt-0.5 flex-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l10 18H2z" />
            <path d="M12 10v5M12 18.2v.1" />
          </svg>
          <span>{SHOWCASE_COPY.sizeMissingWarn}</span>
        </p>
      )}

      {href === null ? (
        <p role="alert" className="rounded-xl border border-[var(--gq-border)] bg-white px-3.5 py-3 text-sm">
          ไซซ์ที่เลือกไม่ถูกต้อง กรุณาเลือกไซซ์ใหม่
        </p>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[var(--gq-burgundy)] text-base font-medium text-white transition-colors hover:bg-[var(--gq-burgundy-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
        >
          {SHOWCASE_COPY.lineButton}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
      )}

      <button
        type="button"
        onClick={onCopy}
        disabled={message === null}
        className="inline-flex min-h-14 w-full items-center justify-center rounded-full border border-[var(--gq-border)] bg-white text-base font-medium text-[var(--gq-text)] transition-colors hover:bg-[var(--gq-burgundy-soft)] disabled:cursor-not-allowed disabled:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
      >
        {copied ? SHOWCASE_COPY.copiedButton : SHOWCASE_COPY.copyButton}
      </button>
      <p role="status" className="sr-only">
        {copied ? SHOWCASE_COPY.copiedButton : ""}
      </p>

      {copyFailed && message !== null && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ring-showcase-copy-fallback" className="text-sm text-[var(--gq-text-muted)]">
            {SHOWCASE_COPY.copyFailed}
          </label>
          <textarea
            id="ring-showcase-copy-fallback"
            readOnly
            rows={7}
            value={message}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-xl border border-[var(--gq-border)] bg-white p-3 text-sm leading-[1.6]"
          />
        </div>
      )}
    </div>
  );
}
