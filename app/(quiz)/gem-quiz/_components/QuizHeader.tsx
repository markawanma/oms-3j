// QuizHeader — header ของจอคำถาม Q1-Q5 (design §5): ปุ่มย้อนกลับ + ตัวนับ
// "01 / 05" + wordmark "3J" + progress bar. พอร์ตจาก quiz shell header ของ
// Quiz.dc.html (บรรทัด ~44-54).
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function QuizHeader({ current, total, onBack }: { current: number; total: number; onBack: () => void }) {
  const progressPct = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;

  return (
    <div className="shrink-0 px-5 pt-3">
      <div className="flex h-11 items-center justify-between">
        <button
          type="button"
          aria-label="ย้อนกลับ"
          onClick={onBack}
          className="-ml-2.5 flex h-11 w-11 items-center justify-center rounded-full text-[var(--gq-text)] transition-colors hover:bg-[var(--gq-burgundy-soft)]"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <span className="text-[13px] tracking-[0.14em] text-[var(--gq-text-muted)]" aria-live="polite">
          {pad2(current)} / {pad2(total)}
        </span>
        <span className="-mr-1 w-11 text-right font-quiz-display text-[13px] font-semibold tracking-[0.2em] text-[var(--gq-burgundy)]">3J</span>
      </div>
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[var(--gq-border-soft)]">
        <div
          className="h-full rounded-full bg-[var(--gq-burgundy)] transition-[width] duration-300 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
