// GemPicker — ตัวเลือกพลอยที่ชอบ (Q4, design §5): เลือกได้สูงสุด `max` ตัว,
// โชว์อันดับที่เลือก (rank badge), disable ตัวที่เหลือเมื่อครบ. พอร์ตสไตล์
// แถวจาก Quiz.dc.html (บรรทัด ~204-215).
import { GemIcon } from "./GemIcon";
import type { GemQuizStoneConfig } from "@/lib/gem-quiz/config";

export function GemPicker({
  stones,
  selected,
  onToggle,
  max,
}: {
  /** ลำดับการแสดงผล — ควบคุมจากผู้เรียก (สุ่มหลัง mount ตามกฎ hydration §5) */
  stones: readonly GemQuizStoneConfig[];
  /** ลำดับมีความหมาย — index 0 = อันดับ 1 ที่แตะ */
  selected: readonly string[];
  onToggle: (code: string) => void;
  max: number;
}) {
  const statusText =
    selected.length === 0 ? "แตะเพื่อเลือกอย่างน้อย 1 พลอย" : `เลือกแล้ว ${selected.length} จาก ${max} พลอย`;

  return (
    <div className="flex flex-col gap-4">
      <p
        className="self-center rounded-full px-3.5 py-1.5 text-[13px]"
        style={{
          background: selected.length > 0 ? "var(--gq-burgundy-soft)" : "var(--gq-border-soft)",
          color: selected.length > 0 ? "var(--gq-burgundy-dark)" : "var(--gq-text-muted)",
        }}
        aria-live="polite"
      >
        {statusText}
      </p>
      <fieldset className="flex flex-col gap-2.5" aria-label="พลอยที่ดึงดูดคุณที่สุด">
        <legend className="sr-only">พลอยที่ดึงดูดคุณที่สุด — เลือกได้สูงสุด {max} ตัว เรียงตามลำดับที่ชอบ</legend>
        {stones.map((stone) => {
          const rank = selected.indexOf(stone.code);
          const isSelected = rank >= 0;
          const disabled = !isSelected && selected.length >= max;
          return (
            <button
              key={stone.code}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onToggle(stone.code)}
              className={`flex min-h-[78px] w-full items-center gap-3.5 rounded-2xl border py-2.5 pl-2.5 pr-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected
                  ? "border-[var(--gq-burgundy)] bg-[var(--gq-burgundy-soft)]"
                  : "border-[var(--gq-border)] hover:border-[var(--gq-burgundy-border)]"
              }`}
            >
              <span className="flex h-[58px] w-[58px] flex-none items-center justify-center rounded-xl bg-[var(--gq-ivory)]">
                <GemIcon colors={stone.colors} size={42} />
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-base font-medium text-[var(--gq-text)]">
                  {stone.nameEn} <span className="font-normal text-[var(--gq-text-muted)]">· {stone.labelTh}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[13px] text-[var(--gq-text-muted)]">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: stone.colors.base }} />
                  {stone.mood}
                </span>
              </span>
              {isSelected ? (
                <span
                  aria-hidden="true"
                  className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-[var(--gq-burgundy)] text-sm font-semibold text-white"
                >
                  {rank + 1}
                </span>
              ) : (
                <span aria-hidden="true" className="h-7 w-7 flex-none rounded-full border border-[var(--gq-border)]" />
              )}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}
