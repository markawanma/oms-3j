"use client";

// GoldGuardWarning — กล่องแดง "ใบทองไม่มีด่านกันทองหายในบางขั้น" (0176 · ออฟฟิศเห็นเท่านั้น — ห้ามไปหน้าช่าง/ใบพิมพ์)
// variant "ack": ฟอร์มสร้างใบงาน/เปลี่ยนแบบ — ต้องติ๊กรับทราบก่อนสร้าง (ack ไม่ส่ง server · รีเซ็ตโดยผู้เรียกเมื่อเปลี่ยนแบบ/ขั้น)
// variant "info": กล่องยืนยันตั้งค่าเริ่มงานทอง — เตือนอย่างเดียว ไม่ต้อง ack
// ไม่ตัดสินเอง: ผู้เรียกส่งรายชื่อขั้นที่ "โลหะอยู่ในมือแต่ไม่ชั่ง" มา (lib/jobs/profile-summary.ts) · ด่านจริงอยู่ที่ DB

import { ShieldAlert } from "lucide-react";

interface Props {
  idPrefix: string;
  /** ชื่อไทยของขั้นที่โลหะอยู่ในมือแต่ไม่ชั่ง */
  stageNames: readonly string[];
  variant: "ack" | "info";
  /** variant ack: แบบนี้บังคับน้ำหนักสุทธิตอนปิดงานไหม (บอกผลจริงให้ตรงกับ DB) */
  requireFinalWeight?: boolean;
  ack?: boolean;
  onAck?: (v: boolean) => void;
  disabled?: boolean;
}

export function GoldGuardWarning({ idPrefix, stageNames, variant, requireFinalWeight, ack = false, onAck, disabled }: Props) {
  if (stageNames.length === 0) return null;
  const list = stageNames.join(", ");
  if (variant === "info") {
    return (
      <div role="alert" className="flex gap-2 rounded-md border-2 border-red-400 bg-red-50 p-3 text-sm text-red-900">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">ใบทองใหม่ทุกใบจะเริ่มด้วยแบบนี้</span> — ขั้น {list} ไม่ชั่ง ไม่มีด่านกันทองหาย
        </p>
      </div>
    );
  }
  return (
    <div role="alert" className="space-y-2 rounded-md border-2 border-red-400 bg-red-50 p-3 text-sm text-red-900">
      <div className="flex gap-2">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-semibold">ใบทองนี้ไม่มีด่านกันทองหายในบางขั้น</p>
          <p>
            ขั้นที่ไม่ชั่ง: <span className="font-semibold">{list}</span> — ถ้าทองหายในขั้นเหล่านี้ ระบบจะไม่เตือน
          </p>
          {requireFinalWeight === false && <p>ตอนปิดงานไม่บังคับใส่น้ำหนักสุทธิ (ยกเว้นแบบที่มีขั้นชั่ง)</p>}
          <p>ด่านเทียบน้ำหนักส่ง-รับ (±0.05 กรัม) ทำงานเฉพาะสองขั้นติดกันที่ชั่งทั้งคู่</p>
        </div>
      </div>
      <label htmlFor={`${idPrefix}-gold-ack`} className="flex min-h-11 items-center gap-2 font-medium">
        <input id={`${idPrefix}-gold-ack`} type="checkbox" className="h-5 w-5 accent-red-700" checked={ack} onChange={(e) => onAck?.(e.target.checked)} disabled={disabled} />
        รับทราบ — ยังต้องการใช้แบบนี้กับใบทอง
      </label>
    </div>
  );
}
