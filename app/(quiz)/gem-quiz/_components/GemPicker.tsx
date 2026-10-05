// GemPicker — ตัวเลือกพลอยที่ชอบ (Q4, design §5): เลือกได้สูงสุด `max` ตัว,
// โชว์อันดับที่เลือก (rank badge), disable ตัวที่เหลือเมื่อครบ. พอร์ตสไตล์
// แถวจาก Quiz.dc.html (บรรทัด ~204-215).
//
// กลับมติ 5 ต.ค. 69: เพิ่มแถว "ยังไม่แน่ใจ แนะนำให้ฉัน" ท้ายลิสต์ — แบบเดียว
// กับตัวเลือกของ Q5 (jewelry_type's "unknown") แต่ Q4 เป็น multi-select ไม่ใช่
// single-select จึงทำเป็น state แยกจาก `selected` (isUnsure) ไม่ใช่ sentinel
// code ปนใน array เดียวกัน (liked ส่งไป server ต้องเป็นรหัสพลอยจริงเท่านั้น —
// validate.ts เช็คกับ GEM_QUIZ_STONE_CODES whitelist) เลือกแถวนี้ = exclusive
// กับการเลือกพลอยจริง (toggle พลอยใดๆ ต้องเคลียร์ isUnsure ที่ชั้นเรียก —
// ดู GemQuizClient.tsx's toggleLiked/selectUnsurePreference)
import { GemIcon } from "./GemIcon";
import type { GemQuizStoneConfig } from "@/lib/gem-quiz/config";

export function GemPicker({
  stones,
  selected,
  onToggle,
  max,
  isUnsure,
  onSelectUnsure,
}: {
  /** ลำดับการแสดงผล — ควบคุมจากผู้เรียก (สุ่มหลัง mount ตามกฎ hydration §5) */
  stones: readonly GemQuizStoneConfig[];
  /** ลำดับมีความหมาย — index 0 = อันดับ 1 ที่แตะ */
  selected: readonly string[];
  onToggle: (code: string) => void;
  max: number;
  /** true = แตะ "ยังไม่แน่ใจ แนะนำให้ฉัน" ไว้ (exclusive กับ selected) */
  isUnsure: boolean;
  onSelectUnsure: () => void;
}) {
  const statusText = isUnsure
    ? "ให้ 3J แนะนำพลอยให้คุณ"
    : selected.length === 0
      ? "แตะเพื่อเลือกพลอย หรือให้เราแนะนำให้ก็ได้"
      : `เลือกแล้ว ${selected.length} จาก ${max} พลอย`;

  return (
    <div className="flex flex-col gap-4">
      <p
        className="self-center rounded-full px-3.5 py-1.5 text-[13px]"
        style={{
          background: selected.length > 0 || isUnsure ? "var(--gq-burgundy-soft)" : "var(--gq-border-soft)",
          color: selected.length > 0 || isUnsure ? "var(--gq-burgundy-dark)" : "var(--gq-text-muted)",
        }}
        aria-live="polite"
      >
        {statusText}
      </p>
      <fieldset className="flex flex-col gap-2.5" aria-label="พลอยที่ดึงดูดคุณที่สุด">
        <legend className="sr-only">
          พลอยที่ดึงดูดคุณที่สุด — เลือกได้สูงสุด {max} ตัว เรียงตามลำดับที่ชอบ หรือเลือก "ยังไม่แน่ใจ แนะนำให้ฉัน"
        </legend>
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
        <button
          type="button"
          aria-pressed={isUnsure}
          onClick={onSelectUnsure}
          className={`flex min-h-[78px] w-full items-center gap-3.5 rounded-2xl border py-2.5 pl-2.5 pr-4 text-left transition-colors ${
            isUnsure
              ? "border-[var(--gq-burgundy)] bg-[var(--gq-burgundy-soft)]"
              : "border-[var(--gq-border)] hover:border-[var(--gq-burgundy-border)]"
          }`}
        >
          <span className="flex h-[58px] w-[58px] flex-none items-center justify-center rounded-xl bg-[var(--gq-ivory)]">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--gq-burgundy)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-1.2 2-2 2.6-.6.5-1 1-1 1.9" />
              <circle cx="12" cy="17.5" r="0.75" fill="var(--gq-burgundy)" stroke="none" />
            </svg>
          </span>
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-base font-medium text-[var(--gq-text)]">ยังไม่แน่ใจ</span>
            <span className="text-[13px] text-[var(--gq-text-muted)]">แนะนำให้ฉัน</span>
          </span>
          {isUnsure ? (
            <span
              aria-hidden="true"
              className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-[var(--gq-burgundy)] text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          ) : (
            <span aria-hidden="true" className="h-7 w-7 flex-none rounded-full border border-[var(--gq-border)]" />
          )}
        </button>
      </fieldset>
    </div>
  );
}
