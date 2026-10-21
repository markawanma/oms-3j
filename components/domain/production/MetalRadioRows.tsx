"use client";

// MetalRadioRows — radiogroup เลือกโลหะ 3 ตัว เห็นทุกตัวเลือก+สีตลอด (ต่างจาก <select> ของ OEM — UX §A.11)
// native <input type=radio> (ซ่อนด้วย sr-only) = คีย์บอร์ดลูกศร/space ใช้ได้ฟรี · ปุ่ม ≥ 44px
// ล็อก (มีใบงานเดินอยู่): aria-disabled บนกลุ่ม + ข้อความเหตุผล (aria-describedby) — ไม่ใช้ disabled จริง เพราะ disabled ไม่รับ focus/ไม่ถูกอ่านให้ผู้ใช้คีย์บอร์ด

import { useId } from "react";
import type { ProductionMetal } from "@/lib/production/types";
import { PRODUCTION_METALS } from "@/lib/production/types";
import { METAL_TAG } from "@/lib/production/metal-ui";

export function MetalRadioRows({
  value,
  onChange,
  legend = "วัสดุ",
  disabledReason,
  busy,
  describedBy,
}: {
  value: ProductionMetal;
  onChange: (next: ProductionMetal) => void;
  legend?: string;
  /** มีค่า = ล็อกทั้งกลุ่ม (aria-disabled) แล้วแสดงเหตุผลใต้ปุ่ม */
  disabledReason?: string | null;
  /** กำลังบันทึก — ปิดการเลือกชั่วคราว (ไม่ใช่ล็อกถาวร) */
  busy?: boolean;
  describedBy?: string;
}) {
  const uid = useId();
  const reasonId = `${uid}-reason`;
  const locked = !!disabledReason;
  return (
    <div>
      <div role="radiogroup" aria-label={legend} aria-disabled={locked || busy ? true : undefined} aria-describedby={locked ? reasonId : describedBy} className="flex flex-wrap gap-2">
        {PRODUCTION_METALS.map((m) => {
          const t = METAL_TAG[m];
          const checked = value === m;
          return (
            <label
              key={m}
              className={`relative inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-600 ${
                checked ? `${t.className} ring-2 ring-zinc-900` : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              } ${locked || busy ? "cursor-not-allowed opacity-70" : ""}`}
            >
              <input
                type="radio"
                name={`${uid}-metal`}
                value={m}
                checked={checked}
                aria-disabled={locked || busy ? true : undefined}
                onChange={() => {
                  if (locked || busy) return;
                  onChange(m);
                }}
                className="sr-only"
              />
              <span aria-hidden="true">{t.glyph}</span>
              {t.label}
            </label>
          );
        })}
      </div>
      {locked && (
        <p id={reasonId} className="mt-1 text-xs text-zinc-700">
          {disabledReason}
        </p>
      )}
    </div>
  );
}
