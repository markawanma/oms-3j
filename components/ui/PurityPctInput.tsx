"use client";

// PurityPctInput — ช่องกรอก "ความบริสุทธิ์/เนื้อโลหะ" เป็น % (ทศนิยมไม่เกิน 2 ตำแหน่ง) ใช้ร่วมกันทุกฟอร์ม
// (มติเจ้าของ 18 ต.ค. 69) — ตัวช่องเก็บเป็นสตริง % ตามที่พิมพ์ (เช่น "92.50") ไม่แปลงเงียบๆ ระหว่างพิมพ์
// การแปลงเป็นสัดส่วน 0..1 ทำที่ lib/units/purity.ts ตอนประกอบ payload เท่านั้น
//
// ผิดกติกา (ทศนิยมตำแหน่งที่ 3 · <1% · >100% · ไม่ใช่ตัวเลข) = แสดงข้อความสีแดงใต้ช่องทันที
// ไม่ตัด/ปัดค่าให้ — ค่าไม่เปลี่ยนเงียบๆ และผู้เรียกใช้ purityPctIssue() เดียวกันกัน submit

import { useId } from "react";
import { PURITY_PCT_EXAMPLE, purityPctIssue } from "@/lib/units/purity";

export function PurityPctInput({
  value,
  onChange,
  className,
  placeholder = PURITY_PCT_EXAMPLE,
  required,
  issue,
}: {
  value: string;
  onChange: (next: string) => void;
  /** class ของ <input> (ผู้เรียกส่ง inputCls ของฟอร์มตัวเอง — ไม่มีสไตล์ซ้ำซ้อนที่นี่) */
  className?: string;
  placeholder?: string;
  required?: boolean;
  /** ข้อความ error ที่ผู้เรียกคำนวณเอง (เช่น ผ่านการเช็ค "ไม่แตะ" ของค่าเดิม) — ไม่ส่ง = ตรวจจากค่าในช่องเอง */
  issue?: string | null;
}) {
  const errorId = useId();
  const shownIssue = issue !== undefined ? issue : purityPctIssue(value);
  return (
    <div>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          aria-invalid={shownIssue ? true : undefined}
          aria-describedby={shownIssue ? errorId : undefined}
          className={`${className ?? ""} w-full pr-8 ${shownIssue ? "ring-1 ring-red-500" : ""}`}
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-zinc-500">
          %
        </span>
      </div>
      {shownIssue && (
        <p id={errorId} role="alert" className="pt-0.5 text-[11px] font-normal text-red-600">
          {shownIssue}
        </p>
      )}
    </div>
  );
}
