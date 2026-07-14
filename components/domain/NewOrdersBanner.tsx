"use client";

import { ArrowUp } from "lucide-react";

/**
 * Sticky banner shown when new orders have arrived since the list was
 * loaded. Deliberately NOT auto-merged into the list (ux-ui design: "กดเอง
 * merge — กัน layout กระโดด") — the user must tap it to refetch, so scroll
 * position never jumps under them while reading.
 */
export function NewOrdersBanner({ count, onMerge }: { count: number; onMerge: () => void }) {
  if (count <= 0) return null;

  return (
    <button
      onClick={onMerge}
      className="sticky top-0 z-10 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-medium text-white shadow-md"
      aria-live="polite"
    >
      <ArrowUp className="h-4 w-4" aria-hidden="true" />
      มีออเดอร์ใหม่ {count} รายการ — กดเพื่อโหลด
    </button>
  );
}
