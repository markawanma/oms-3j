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
  isUnsure,
  onSelectUnsure,
  max,
  onNext,
  onBack,
  current,
  total,
}: {
  stones: readonly GemQuizStoneConfig[];
  selected: readonly string[];
  onToggle: (code: string) => void;
  /** กลับมติ 5 ต.ค. 69: MIN_LIKED_STONES เป็น 0 แล้ว (รองรับ "ยังไม่แน่ใจ") —
   * ด่านของจอนี้จึงไม่ใช่ "เลือกครบ min ตัว" อีกต่อไป แต่เป็น "ต้องเลือกพลอย
   * อย่างน้อย 1 ตัว หรือกด 'ยังไม่แน่ใจ' อย่างใดอย่างหนึ่ง" (ด่านจริงยังอยู่ที่
   * validate.ts/DB เหมือนเดิม จอนี้แค่ปิดปุ่ม "ถัดไป" ให้ตรงกับ UX ที่ตั้งใจ) */
  isUnsure: boolean;
  onSelectUnsure: () => void;
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
          <GemPicker
            stones={stones}
            selected={selected}
            onToggle={onToggle}
            max={max}
            isUnsure={isUnsure}
            onSelectUnsure={onSelectUnsure}
          />
        </div>
      </div>

      <div className="border-t border-[var(--gq-border-soft)] px-5 py-5">
        <PrimaryButton onClick={onNext} disabled={selected.length === 0 && !isUnsure} trailingArrow>
          ถัดไป
        </PrimaryButton>
      </div>
    </div>
  );
}
