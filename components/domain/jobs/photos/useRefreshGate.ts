"use client";

// useRefreshGate — ด่านกัน "ขอลิงก์รูปใหม่อัตโนมัติวนไม่จบ" (ชั้นแสดงผลล้วน · ใช้ทั้งการ์ดออฟฟิศและหน้าช่าง)
// ลิงก์รูปหมดอายุ 15 นาที → รูปล้ม = ขอลิงก์ใหม่ให้เอง · แต่ถ้ารูปพังเพราะเหตุอื่น (ไฟล์หาย/Storage ล่ม) ลิงก์ใหม่ก็พังซ้ำ → วนไม่รู้จบ
// กติกา: อัตโนมัติ ("error") ห่างกัน ≥ minGapMs และไม่เกิน maxAuto ครั้งติดกัน จนผู้ใช้แตะ "ลองใหม่" ("tap" ผ่านเสมอ แล้วรีเซ็ตตัวนับ)
// รอบหมดอายุถัดไป (ห่างเกิน resetAfterMs — ลิงก์อายุ 15 นาที) นับใหม่เอง เพื่อหน้าที่เปิดค้างนานยังโหลดรูปใหม่ได้เอง

import { useCallback, useRef } from "react";
import type { RetryReason } from "@/components/domain/jobs/photos/types";

export function useRefreshGate({ minGapMs = 10_000, maxAuto = 2, resetAfterMs = 5 * 60_000 }: { minGapMs?: number; maxAuto?: number; resetAfterMs?: number } = {}): (reason: RetryReason) => boolean {
  const st = useRef({ last: 0, count: 0 });
  return useCallback(
    (reason: RetryReason) => {
      const now = Date.now();
      const s = st.current;
      if (reason === "tap") {
        s.count = 0;
        s.last = now;
        return true;
      }
      if (now - s.last > resetAfterMs) s.count = 0;
      if (s.count >= maxAuto || now - s.last < minGapMs) return false;
      s.count += 1;
      s.last = now;
      return true;
    },
    [minGapMs, maxAuto, resetAfterMs],
  );
}
