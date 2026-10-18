"use client";

// QtyBufferToggle — สวิตช์ "เผื่อของเสีย (ไม่บังคับ)" ของฟอร์มสร้างใบงาน (มติเจ้าของ 18 ต.ค. 69)
// <button role="switch" aria-checked> สูง >= 44px · label ผูกข้อความด้วย aria-labelledby · สถานะบอกเป็นตัวอักษร "เปิด/ปิด" (ไม่พึ่งสีอย่างเดียว)
// ไม่มีตรรกะจำนวน/เงิน — แค่สวิตช์ · ค่าเริ่มปิดทุกครั้งที่เปิดกล่อง (ผู้เรียกเป็นเจ้าของ state)

interface Props {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function QtyBufferToggle({ id, checked, onChange, disabled }: Props) {
  const labelId = `${id}-label`;
  return (
    <div className="flex min-h-11 items-center gap-3">
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
      <span id={labelId} className="text-sm font-medium text-zinc-900">
        เผื่อของเสีย <span className="font-normal text-zinc-700">(ไม่บังคับ)</span>
      </span>
    </div>
  );
}
