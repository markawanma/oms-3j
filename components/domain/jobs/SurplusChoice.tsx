"use client";

// SurplusChoice — ตัวเลือกจัดการ "ของเหลือ" (ดี > จำนวนที่สั่ง) ของงาน OEM: ถือไว้ก่อน (ค่าเริ่ม) · อะไหล่/ตัวอย่างของดีลนี้ · ส่งแถมลูกค้า
// 🔴 งาน OEM ห้ามมีตัวเลือก "เข้าสต็อก" (ของเหลือเป็นของลูกค้า — DB ปฏิเสธ surplus_oem_no_stock) · ใบผลิตไม่มีตัวเลือกเลย (DB ตั้ง stock ตอนปิดใบผลิต)
// ไม่พึ่ง JobDialogs (ถูก import จากที่นั่น — กัน import วน)

export type SurplusValue = "hold" | "spare" | "deliver";

export const SURPLUS_OPTIONS: { value: SurplusValue; label: string }[] = [
  { value: "hold", label: "ถือไว้ก่อน ตัดสินทีหลัง (แนะนำ)" },
  { value: "spare", label: "เก็บเป็นอะไหล่/ตัวอย่างของดีลนี้" },
  { value: "deliver", label: "ส่งแถมลูกค้า" },
];

export const SURPLUS_DONE_LABEL: Record<string, string> = {
  hold: "ถือไว้ ยังไม่ตัดสิน",
  spare: "เก็บเป็นอะไหล่/ตัวอย่างของดีลนี้",
  deliver: "ส่งแถมลูกค้า",
  stock: "เข้าสต็อกแล้ว",
};

const INPUT = "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

export function SurplusChoice({ idPrefix, value, onChange, note, onNote, disabled }: { idPrefix: string; value: SurplusValue; onChange: (v: SurplusValue) => void; note: string; onNote: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <fieldset className="space-y-1" disabled={disabled}>
        <legend className="text-sm font-medium text-zinc-800">จัดการของเหลืออย่างไร</legend>
        {SURPLUS_OPTIONS.map((o) => (
          <label key={o.value} className="flex min-h-11 items-center gap-2 text-base text-zinc-900">
            <input type="radio" name={`${idPrefix}-surplus`} className="h-5 w-5 accent-primary-600" checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-surplus-note`} className="block text-sm font-medium text-zinc-800">
          หมายเหตุของเหลือ (ไม่บังคับ)
        </label>
        <input id={`${idPrefix}-surplus-note`} value={note} onChange={(e) => onNote(e.target.value)} maxLength={200} disabled={disabled} className={INPUT} />
      </div>
    </div>
  );
}
