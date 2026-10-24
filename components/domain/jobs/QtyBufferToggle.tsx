"use client";

// QtyBufferToggle — สวิตช์ "เผื่อของเสีย (ไม่บังคับ)" ของฟอร์มสร้างใบงาน (มติเจ้าของ 18 ต.ค. 69)
// ตัวสวิตช์ = SwitchField (สกัดออกไปใช้ซ้ำใน G1b) · ไม่มีตรรกะจำนวน/เงิน — แค่สวิตช์ · ค่าเริ่มปิดทุกครั้งที่เปิดกล่อง (ผู้เรียกเป็นเจ้าของ state)

import { SwitchField } from "@/components/domain/jobs/SwitchField";

interface Props {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function QtyBufferToggle({ id, checked, onChange, disabled }: Props) {
  return (
    <SwitchField
      id={id}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      label={
        <>
          เผื่อของเสีย <span className="font-normal text-zinc-700">(ไม่บังคับ)</span>
        </>
      }
    />
  );
}
