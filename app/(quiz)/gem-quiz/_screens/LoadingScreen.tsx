// LoadingScreen (S06) — จอรอผลลัพธ์ ~1.5s (design §5). ไฟล์นี้ presentational
// ล้วน ไม่มี timer ของตัวเอง — GemQuizClient เป็นคนตั้ง/เคลียร์ setTimeout ที่
// เปลี่ยนไปหน้า "result" (กฎ hydration §5: "timer เริ่มใน useEffect/handler +
// ต้อง clear ใน cleanup function").
import { GemIcon } from "../_components/GemIcon";
import type { GemQuizStoneColors } from "@/lib/gem-quiz/config";

const CHECKLIST = [
  "วันเกิด",
  "สิ่งที่คุณอยากเสริมวันนี้",
  "ความรู้สึกของคุณ",
  "พลอยที่คุณชอบ",
  "สไตล์เครื่องประดับของคุณ",
] as const;

function CheckIcon({ twinkle = false }: { twinkle?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--gq-burgundy)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={twinkle ? "motion-safe:animate-gq-twinkle" : undefined}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function LoadingScreen({ heroColors }: { heroColors: GemQuizStoneColors }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-9 text-center sm:min-h-[700px]"
    >
      <span className="sr-only">กำลังค้นหาพลอยที่เหมาะกับคุณ โปรดรอสักครู่</span>
      <div className="relative flex h-[168px] w-[168px] items-center justify-center" aria-hidden="true">
        <div className="motion-safe:animate-gq-spin-slow absolute inset-0 rounded-full border border-[var(--gq-border-soft)] border-t-[var(--gq-burgundy)]" />
        <div className="motion-safe:animate-gq-spin-slow-rev absolute inset-[18px] rounded-full border border-dashed border-[var(--gq-burgundy-border)]" />
        <div className="motion-safe:animate-pulse">
          <GemIcon colors={heroColors} size={74} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-quiz-display text-[13px] font-semibold tracking-[0.4em] text-[var(--gq-burgundy)]">3J · JEWELRY</span>
        <h1 className="font-quiz-serif text-xl font-semibold leading-[1.4] text-[var(--gq-burgundy-dark)]">
          กำลังค้นหาพลอย
          <br />
          ที่เหมาะกับคุณ…
        </h1>
      </div>
      <div className="flex flex-col items-start gap-2.5 text-sm text-[var(--gq-text-muted)]">
        <span className="text-xs tracking-[0.08em]">วิเคราะห์จาก</span>
        {CHECKLIST.map((item, i) => (
          <span key={item} className="flex items-center gap-2.5">
            <CheckIcon twinkle={i === CHECKLIST.length - 1} />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
