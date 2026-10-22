"use client";

// ชิ้นส่วนหน้าตาที่ใช้ร่วมในกลุ่มจอพลอย (ไม่พึ่ง JobDialogs เพื่อไม่ลาก action ของใบงานเข้ามา)

import { useEffect } from "react";
import type { ReactNode, RefObject } from "react";

export const GEM_FIELD =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 aria-[invalid=true]:border-red-500 disabled:bg-zinc-100 disabled:text-zinc-500";

export function GemErrorLine({ message, id }: { message: string | null | undefined; id?: string }) {
  return message ? (
    <p id={id} role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800 break-words">
      {message}
    </p>
  ) : null;
}

export function FieldMsg({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 flex items-start gap-1 text-xs font-medium text-red-700 break-words">
      <span aria-hidden="true">⚠</span>
      <span>{children}</span>
    </p>
  );
}

/** Modal ของโปรเจกต์โฟกัสตัวกล่องหลัง mount — ใช้ setTimeout 0 ย้ายโฟกัสไปปุ่มที่ปลอดภัย (ใช้ตัวที่มี / ไม่ล้าง / ยกเลิก) */
export function useFocusAfterOpen(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [ref, active]);
}
