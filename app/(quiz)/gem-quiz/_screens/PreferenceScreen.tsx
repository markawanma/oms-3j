// PreferenceScreen (Q4) — "พลอยไหนดึงดูดคุณที่สุด?" (design §5). ใช้
// GemPicker เลือกได้ 1-3 ตัวเรียงอันดับ (MIN/MAX_LIKED_STONES ของ config.ts).
import { GemPicker } from "../_components/GemPicker";
import { PrimaryButton } from "../_components/PrimaryButton";
import { QuizHeader } from "../_components/QuizHeader";
import type { GemQuizStoneConfig } from "@/lib/gem-quiz/config";

export function PreferenceScreen({
  stones,
  selected,
  onToggle,
  min,
  max,
  onNext,
  onBack,
  current,
  total,
}: {
  stones: readonly GemQuizStoneConfig[];
  selected: readonly string[];
  onToggle: (code: string) => void;
  /** MIN_LIKED_STONES ของ config.ts — จอนี้ไม่ validate เองเป็นด่านจริง (DB/
   * validate.ts เป็นด่านจริง) แค่ปิดปุ่ม "ถัดไป" ให้ตรงกับ contract เดียวกัน */
  min: number;
  max: number;
  onNext: () => void;
  onBack: () => void;
  current: number;
  total: number;
}) {
  return (
    <div className="motion-safe:animate-gq-fade-up flex min-h-screen flex-col sm:min-h-0">
      <QuizHeader current={current} total={total} onBack={onBack} />

      <div className="flex-1 px-5 py-6">
        <div className="flex flex-col gap-1.5 text-center">
          <h1 className="font-quiz-serif text-[25px] font-semibold leading-[1.35] text-[var(--gq-burgundy-dark)]">
            พลอยไหนดึงดูดคุณที่สุด?
          </h1>
          <p className="text-sm leading-[1.55] text-[var(--gq-text-muted)]">
            เลือกได้สูงสุด {max} พลอย เรียงตามลำดับที่ชอบ
            <br />
            เลือกตามความรู้สึกได้เลย ไม่มีคำตอบที่ถูกหรือผิด
          </p>
        </div>

        <div className="mt-4">
          <GemPicker stones={stones} selected={selected} onToggle={onToggle} max={max} />
        </div>
      </div>

      <div className="border-t border-[var(--gq-border-soft)] px-5 py-5">
        <PrimaryButton onClick={onNext} disabled={selected.length < min} trailingArrow>
          ถัดไป
        </PrimaryButton>
      </div>
    </div>
  );
}
