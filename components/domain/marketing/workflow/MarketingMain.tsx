"use client";

// MarketingMain — กรอบเนื้อหาของสายการตลาด: เว้นล่างบนมือถือให้พอสำหรับแถบล่าง + ปุ่มลอย "แปะลิงก์" (ไม่ให้บังปุ่มท้ายหน้า)
// เงื่อนไขแสดงปุ่มลอยอยู่ที่ lib/marketing/nav.ts ที่เดียว (fabVisible) — ใช้ร่วมกับ MarketingBottomNav

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { mobileBottomPadding } from "@/lib/marketing/nav";

export function MarketingMain({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className={`flex-1 px-4 py-4 md:pb-4 ${mobileBottomPadding(pathname)}`}>{children}</div>;
}
