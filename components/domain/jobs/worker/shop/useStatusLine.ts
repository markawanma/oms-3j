"use client";

// useStatusLine — ข้อความสถานะสั้นๆ ที่หายเอง (แทน toast: หน้าช่าง/ผู้จัดการไม่มี ToastProvider ของแอปออฟฟิศ — components/ui/Toast ห้ามเข้ากราฟสาธารณะ)
// ผู้เรียกวาง <p role="status"> เอง · ล้าง timer ตอน unmount

import { useCallback, useEffect, useRef, useState } from "react";

export function useStatusLine(ms = 4000): [string | null, (message: string | null) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (m: string | null) => {
      if (timer.current) clearTimeout(timer.current);
      setMsg(m);
      if (m !== null) timer.current = setTimeout(() => setMsg(null), ms);
    },
    [ms],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [msg, show];
}
