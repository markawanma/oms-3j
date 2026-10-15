"use client";

// StageFlagChips — ป้ายสั้นต่อท้ายชื่อขั้นในตารางขั้นของใบงาน (0176 · ออฟฟิศเท่านั้น): เทา ชั่ง / ชิ้นเสีย / เศษ · แดง "ไม่ชั่ง" เฉพาะใบทอง
// อ่านจาก snapshot ของขั้นในใบ (flag ตอนสร้าง/เปลี่ยนแบบ) ไม่ใช่แบบสด · ข้อความ + ไอคอน (ไม่พึ่งสีอย่างเดียว) · ไม่ใช้ไอคอนกรรไกร

import { Scale, ShieldOff } from "lucide-react";
import type { StageRow } from "@/lib/jobs/types";

const GRAY = "inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-800";
const RED = "inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-900";

export function StageFlagChips({ stage, gold }: { stage: Pick<StageRow, "status" | "weighRequired" | "scrapQtyAsk" | "scrapWeightAsk" | "metalPresent">; gold: boolean }) {
  // ใบทอง: โลหะอยู่ในมือแต่ไม่ชั่ง = ไม่มีด่านกันทองหาย (ขั้นที่ข้ามไม่นับ)
  const unguarded = gold && stage.metalPresent && !stage.weighRequired && stage.status !== "skipped";
  if (!stage.weighRequired && !stage.scrapQtyAsk && !stage.scrapWeightAsk && !unguarded) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-1 align-middle">
      {stage.weighRequired && (
        <span className={GRAY}>
          <Scale className="h-3 w-3" aria-hidden="true" />
          ชั่ง
        </span>
      )}
      {stage.scrapQtyAsk && <span className={GRAY}>ชิ้นเสีย</span>}
      {stage.scrapWeightAsk && <span className={GRAY}>เศษ</span>}
      {unguarded && (
        <span className={RED}>
          <ShieldOff className="h-3 w-3" aria-hidden="true" />
          ไม่ชั่ง
        </span>
      )}
    </span>
  );
}
