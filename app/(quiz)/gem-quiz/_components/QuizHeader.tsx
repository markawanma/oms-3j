// QuizHeader — header ของจอคำถาม Q1-Q5 (design §5): ปุ่มย้อนกลับ (ซ้าย) + ตัวนับ "01 / 05" (กลาง) + ปุ่ม "เครื่องมือ 3J" (ขวา) + progress bar.
// พอร์ตจาก quiz shell header ของ Quiz.dc.html (บรรทัด ~44-54) · ขวาบนเดิม = ข้อความ "3J" ที่กดไม่ได้ → ตอนนี้เป็นลิงก์ hub
// (มติเจ้าของ 24 พ.ย. 69 · ux-tools-navigation §2) — hubDirty = มีคำตอบ ≥ 2 → ToolsHubExit ถามก่อนออก
import { ToolsHubExit } from "../../_components/ToolsHubExit";
import { GEM_QUIZ_LEAVE_BODY } from "@/lib/gem-quiz/config";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function QuizHeader({
  current,
  total,
  onBack,
  hubDirty = false,
}: {
  current: number;
  total: number;
  onBack: () => void;
  hubDirty?: boolean;
}) {
  const progressPct = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;

  return (
    <div className="shrink-0 px-5 pt-3">
      <div className="grid h-11 grid-cols-[1fr_auto_1fr] items-center">
        <button
          type="button"
          aria-label="ย้อนกลับ"
          onClick={onBack}
          className="-ml-2.5 flex h-11 w-11 items-center justify-center justify-self-start rounded-full text-[var(--gq-text)] transition-colors hover:bg-[var(--gq-burgundy-soft)]"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <span className="text-[13px] tracking-[0.14em] text-[var(--gq-text-muted)]" aria-live="polite">
          {pad2(current)} / {pad2(total)}
        </span>
        <div className="-mr-2 justify-self-end">
          <ToolsHubExit variant="nav" dirty={hubDirty} leaveBody={GEM_QUIZ_LEAVE_BODY} />
        </div>
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
