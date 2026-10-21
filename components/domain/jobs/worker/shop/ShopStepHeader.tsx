"use client";

// ShopStepHeader — หัวทุกขั้นของวิซาร์ด: ปุ่มย้อน (≥ 44px) · บริบท + n/N · แถบความคืบหน้า · h1
// n/N มาจากรายการขั้นจริง (stepsFor) — ขั้นพลอย/รูปที่เพิ่มทีหลังไม่ต้องแก้ตัวนับ · h1 รับ focus (tabIndex -1) ตอนเปลี่ยนขั้นเพื่อให้ screen reader อ่านหัวขั้นใหม่

import { forwardRef } from "react";
import { ChevronLeft } from "lucide-react";

export const ShopStepHeader = forwardRef<HTMLHeadingElement, { title: string; context: string; n: number; total: number; onBack?: () => void; disabled?: boolean }>(function ShopStepHeader({ title, context, n, total, onBack, disabled }, ref) {
  return (
    <header className="space-y-2">
      <div className="flex items-center gap-2">
        {onBack ? (
          <button type="button" onClick={onBack} disabled={disabled} aria-label="ย้อนกลับ" className="-ml-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:opacity-40">
            <ChevronLeft className="h-8 w-8" aria-hidden="true" />
          </button>
        ) : (
          <span className="h-12 w-0" aria-hidden="true" />
        )}
        <p className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-700">{context}</p>
        <p className="shrink-0 text-base font-semibold tabular-nums text-zinc-700">
          {n}/{total}
        </p>
      </div>
      <div role="progressbar" aria-label="ความคืบหน้า" aria-valuemin={1} aria-valuemax={total} aria-valuenow={n} aria-valuetext={`ขั้นที่ ${n} จาก ${total}`} className="flex gap-1">
        {new Array(total).fill(0).map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < n ? "bg-primary-600" : "bg-zinc-200"}`} />
        ))}
      </div>
      <h1 ref={ref} tabIndex={-1} className="text-2xl font-bold text-zinc-900 focus:outline-none">
        {title}
      </h1>
    </header>
  );
});
