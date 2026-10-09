"use client";

// MovedNotice — แถบครั้งเดียวบนปลายทางของ redirect (?from=legacy): "หน้านี้ย้ายมาที่นี่แล้ว" ปิดได้ แล้วลบ param ออกจาก URL (§6)

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Info, X } from "lucide-react";

export function MovedNotice() {
  const router = useRouter();
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div role="status" className="flex items-start justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
      <p className="flex min-w-0 items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>หน้านี้ย้ายมาที่นี่แล้ว — ใช้ปุ่มเดียวกันได้ตามปกติ</span>
      </p>
      <button
        type="button"
        aria-label="ปิดข้อความนี้"
        onClick={() => {
          setHidden(true);
          router.replace(pathname ?? "/marketing");
        }}
        className="-my-1 -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-blue-100"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
