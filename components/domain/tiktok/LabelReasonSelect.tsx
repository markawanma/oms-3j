"use client";

import { LABEL_REASON_OPTIONS } from "@/lib/labels/types";
import type { LabelReasonCode } from "@/lib/labels/types";

/**
 * เหตุผลตอนตั้ง/ตั้งกลับจังหวัด — owner 11 ก.ย. ยืนยันชัดเจน: "ห้ามพิมพ์เอง"
 * dropdown จาก LABEL_REASON_OPTIONS เท่านั้น (mirrors CHECK constraint ใน
 * 0116 — ดู lib/labels/types.ts header). `required` แค่ใส่ style เตือน +
 * placeholder ต่าง — การบังคับจริงอยู่ที่ผู้เรียกก่อนกดส่ง (ดู
 * lib/labels/ui-format.ts validate* / การเช็คใน LabelReviewQueueRow /
 * ProvinceFixPanel).
 */
export function LabelReasonSelect({
  value,
  onChange,
  required,
  disabled,
  ariaLabel,
}: {
  value: LabelReasonCode | "";
  onChange: (v: LabelReasonCode | "") => void;
  required?: boolean;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as LabelReasonCode | "")}
      className={`min-h-11 w-full rounded-md border px-2.5 text-sm text-zinc-900 disabled:bg-zinc-50 disabled:text-zinc-400 ${
        required && !value ? "border-amber-400 bg-amber-50" : "border-zinc-300"
      }`}
    >
      <option value="">{required ? "— เลือกเหตุผล (บังคับ) —" : "— เหตุผล (ไม่บังคับ) —"}</option>
      {LABEL_REASON_OPTIONS.map((opt) => (
        <option key={opt.code} value={opt.code}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
