import type { ReactNode } from "react";

// StickyActionBar — แถบล่างติดขอบจอ (ปุ่มหลัก 56 px + ลิงก์รอง) อยู่ใน container ที่เลื่อนได้ของ layout
// sticky bottom-0 + safe-area-inset-bottom · ห้าม 100vh (ใช้ dvh ที่ layout)

export function StickyActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 mt-auto shrink-0 border-t border-[var(--rs-border)] bg-[var(--rs-bg)] px-[22px] pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
