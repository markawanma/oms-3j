"use client";

// ReviewClock — จับเวลา "เปิดอ่านตั้งแต่เปิดหน้า" ฝั่ง client เพื่อส่งเป็น p_review_seconds ตอนกดอนุมัติ (§1.3 board 1)
// ไม่ใช่ข้อมูลตัดสิน และ "ไม่บล็อก" การอนุมัติ (เร็วกว่า 60 วินาทีแค่ขึ้นข้อความเทา) — DB เก็บไว้เป็นข้อมูลประกอบ

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** อ่านไม่ถึงกี่วินาทีถึงขึ้นข้อความเทา "อ่านไม่ถึง 1 นาที" — เกณฑ์แสดงผลตาม brief ไม่ใช่นโยบายอนุมัติ */
export const QUICK_READ_SECONDS = 60;

const ClockContext = createContext<(() => number) | null>(null);

export function ReviewClockProvider({ children }: { children: ReactNode }) {
  const startedAt = useRef<number | null>(null);
  if (startedAt.current === null) startedAt.current = Date.now();
  const elapsed = useRef(() => Math.max(0, Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)));
  return <ClockContext.Provider value={elapsed.current}>{children}</ClockContext.Provider>;
}

/** คืนฟังก์ชันอ่านวินาทีที่ผ่านไป (ไม่ re-render) — นอก provider = 0 */
export function useReviewElapsed(): () => number {
  return useContext(ClockContext) ?? (() => 0);
}

/** แสดง "เปิดอ่านแล้ว m นาที s วินาที" (อัปเดตทุกวินาที) + ข้อความเทาเมื่อเร็วกว่าเกณฑ์ */
export function ReadTimer() {
  const elapsed = useReviewElapsed();
  const [sec, setSec] = useState(0);
  useEffect(() => {
    setSec(elapsed());
    const t = setInterval(() => setSec(elapsed()), 1000);
    return () => clearInterval(t);
  }, [elapsed]);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (
    <p className="text-xs text-zinc-600">
      <span className="tabular-nums">
        เปิดอ่านแล้ว {m} นาที {s} วินาที
      </span>
      {sec < QUICK_READ_SECONDS && <span> · อ่านไม่ถึง 1 นาที</span>}
    </p>
  );
}
