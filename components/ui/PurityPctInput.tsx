"use client";

// PurityPctInput — ช่องกรอก "ความบริสุทธิ์/เนื้อโลหะ" เป็น % (ทศนิยมไม่เกิน 2 ตำแหน่ง) ใช้ร่วมกันทุกฟอร์ม
// (มติเจ้าของ 18 ต.ค. 69) — ตัวช่องเก็บเป็นสตริง % ตามที่พิมพ์ (เช่น "92.50") ไม่แปลงเงียบๆ ระหว่างพิมพ์
// การแปลงเป็นสัดส่วน 0..1 ทำที่ lib/units/purity.ts ตอนประกอบ payload เท่านั้น
//
// ผิดกติกา (ทศนิยมตำแหน่งที่ 3 · ต่ำกว่า 37.50% · >100% · ไม่ใช่ตัวเลข) = ไม่ตัด/ไม่ปัดค่าให้ และผู้เรียกใช้ purityPctIssue()
// เดียวกันกันบันทึก/กันยิง calc "ทันที" แม้ยังไม่ blur — แต่ข้อความ error (+ role="alert") แสดง **หลัง blur** เท่านั้น
// เพื่อไม่ให้พิมพ์ "96.5" แล้ว "9" วูบแดง/ถูกอ่านออกเสียงทุกปุ่ม (code review 18 ต.ค. 69)
// ผู้เรียกที่ block การบันทึกเองต้องส่ง forceShow=true หลังพยายามบันทึก — ห้ามบล็อกเงียบโดยไม่มีข้อความ

import { useId, useState } from "react";
import { PURITY_PCT_EXAMPLE, purityPctIssue } from "@/lib/units/purity";

export function PurityPctInput({
  value,
  onChange,
  className,
  placeholder = PURITY_PCT_EXAMPLE,
  issue,
  forceShow,
  id,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  /** class ของ <input> (ผู้เรียกส่ง inputCls ของฟอร์มตัวเอง — ไม่มีสไตล์ซ้ำซ้อนที่นี่) */
  className?: string;
  placeholder?: string;
  /** ข้อความ error ที่ผู้เรียกคำนวณเอง (เช่น ผ่านการเช็ค "ไม่แตะ" ของค่าเดิม) — ไม่ส่ง = ตรวจจากค่าในช่องเอง */
  issue?: string | null;
  /** แสดง error ทันทีโดยไม่รอ blur — ผู้เรียกตั้ง true หลังผู้ใช้พยายามบันทึกขณะค่าผิด */
  forceShow?: boolean;
  /** id ของ <input> — ให้ผู้เรียกผูก <label htmlFor> / โฟกัสช่องเมื่อบันทึกไม่ผ่าน (ไม่ส่ง = ไม่มี id เหมือนเดิม DOM ไม่เปลี่ยน) */
  id?: string;
  /** ปิดช่อง (เช่น ระหว่างบันทึก) — ไม่ส่ง = ไม่มี attribute เหมือนเดิม DOM ไม่เปลี่ยน */
  disabled?: boolean;
}) {
  const errorId = useId();
  const [touched, setTouched] = useState(false);
  const actualIssue = issue !== undefined ? issue : purityPctIssue(value);
  const shownIssue = touched || forceShow ? actualIssue : null;
  return (
    <div>
      <div className="relative">
        <input
          id={id}
          disabled={disabled}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={placeholder}
          // aria-invalid บอกสถานะจริงเสมอ (ไม่ถูกอ่านออกเสียงเอง) — ส่วนข้อความ/สีแดงรอ blur
          aria-invalid={actualIssue ? true : undefined}
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
