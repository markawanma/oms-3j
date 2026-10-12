"use client";

// RememberView — จำมุมมองล่าสุดใน cookie (อ่านฝั่ง server เมื่อเปิดหน้าโดยไม่มี ?view=) · cookie ไม่มีข้อมูลส่วนตัว อายุ 1 ปี

import { useEffect } from "react";
import { VIEW_COOKIE } from "@/lib/marketing/calendar-view";
import type { CalendarView } from "@/lib/marketing/calendar-view";

export function RememberView({ view }: { view: CalendarView }) {
  useEffect(() => {
    document.cookie = `${VIEW_COOKIE}=${view}; path=/marketing; max-age=31536000; samesite=lax`;
  }, [view]);
  return null;
}
