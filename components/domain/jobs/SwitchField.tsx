"use client";

// SwitchField — สวิตช์เปิด/ปิดแบบ <button role="switch" aria-checked> สูง >= 44px (สกัดจาก QtyBufferToggle · G1b ใช้ซ้ำกับสวิตช์ "ต้นทุนประมาณ")
// label ผูกข้อความด้วย aria-labelledby · สถานะบอกเป็นตัวอักษร "เปิด/ปิด" (ไม่พึ่งสีอย่างเดียว) · ไม่มีตรรกะอื่น — ผู้เรียกเป็นเจ้าของ state

import type { ReactNode } from "react";

interface Props {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function SwitchField({ id, checked, onChange, label, disabled, className = "" }: Props) {
  const labelId = `${id}-label`;
  return (
    <div className={`flex min-h-11 items-center gap-3 ${className}`}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-11 w-16 shrink-0 items-center rounded-md border px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? "border-primary-600 bg-primary-600" : "border-zinc-300 bg-zinc-100"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-flex h-8 w-8 items-center justify-center rounded bg-white text-[11px] font-bold shadow transition-transform ${checked ? "translate-x-6 text-primary-700" : "translate-x-0 text-zinc-700"}`}
        >
          {checked ? "เปิด" : "ปิด"}
        </span>
      </button>
      <label id={labelId} htmlFor={id} className="min-h-11 flex-1 cursor-pointer content-center text-sm font-medium text-zinc-900">
        {label}
      </label>
    </div>
  );
}
