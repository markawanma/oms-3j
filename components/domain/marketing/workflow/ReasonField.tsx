"use client";

// ReasonField — textarea เหตุผล/ข้อความยาว + ตัวนับ + ข้อผิดพลาดใต้ช่อง (id + aria-describedby + role="alert")
// ค่าที่พิมพ์เก็บที่ parent — เมื่อ error ห้าม reset (แผน §4 "ผู้ใช้พิมพ์เหตุผลยาวแล้ว error หาย")

import { useId } from "react";

export function ReasonField({
  label,
  value,
  onChange,
  max = 500,
  min = 0,
  rows = 3,
  error,
  hint,
  placeholder,
  autoFocus = false,
  required = false,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  min?: number;
  rows?: number;
  error?: string | null;
  hint?: string;
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
  inputRef?: React.Ref<HTMLTextAreaElement>;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const tooShort = min > 0 && value.trim().length > 0 && value.trim().length < min;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-zinc-800">
        {label}
        {required && (
          <span className="ml-1 text-xs font-normal text-zinc-600">
            (ต้องใส่{min > 0 ? ` อย่างน้อย ${min} ตัวอักษร` : ""})
          </span>
        )}
      </label>
      <textarea
        id={id}
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={max + 200}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
        className={`w-full rounded-md border bg-white p-2.5 text-base leading-relaxed text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 ${
          error ? "border-red-400" : "border-zinc-300"
        }`}
      />
      <div className="flex items-start justify-between gap-2 text-xs text-zinc-600">
        <div className="min-w-0">
          {hint && (
            <p id={hintId} className="break-words">
              {hint}
            </p>
          )}
          {value.length > max && <p className="font-medium text-red-700">ยาวเกิน {max} ตัวอักษร — ตัดออกก่อนส่ง</p>}
          {tooShort && <p className="text-amber-800">ใส่อีกอย่างน้อย {min - value.trim().length} ตัวอักษร</p>}
          {error && (
            <p id={errId} role="alert" className="font-medium text-red-700">
              {error}
            </p>
          )}
        </div>
        <span className={`shrink-0 tabular-nums ${value.length > max ? "font-semibold text-red-700" : ""}`}>
          {value.length}/{max}
        </span>
      </div>
    </div>
  );
}
