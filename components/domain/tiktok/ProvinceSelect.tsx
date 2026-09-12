"use client";

import type { CrmProvinceOption } from "@/lib/crm/order-override";

/**
 * Full 77-province dropdown — shared by the label review queue
 * (LabelReviewQueueRow) and ProvinceFixPanel, per owner 11 ก.ย. decision #2:
 * "จังหวัดปัจจุบัน ≠ TH-XX บังคับเลือกเหตุผลก่อนกดยืนยัน" implies free-text is
 * never an option here — always pick from `provinces` (getCrmEditOptions()).
 */
export function ProvinceSelect({
  value,
  onChange,
  provinces,
  disabled,
  ariaLabel,
  placeholder = "— เลือกจังหวัด —",
}: {
  value: string;
  onChange: (code: string) => void;
  provinces: CrmProvinceOption[];
  disabled?: boolean;
  ariaLabel: string;
  placeholder?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled || provinces.length === 0}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900 disabled:bg-zinc-50 disabled:text-zinc-400"
    >
      <option value="">{provinces.length === 0 ? "โหลดรายชื่อจังหวัดไม่สำเร็จ" : placeholder}</option>
      {provinces.map((p) => (
        <option key={p.code} value={p.code}>
          {p.nameTh}
        </option>
      ))}
    </select>
  );
}
