// StatusChip — ป้ายสถานะใบงาน (ข้อความ + ไอคอน + สี ไม่พึ่งสีอย่างเดียว) ใช้ทั้ง "งานที่วิ่งอยู่" และ JobCard
// tone ชุดเดียวกัน: แดง/amber/เทา/เขียว/ฟ้า(ข้อมูลประกอบ) — ห้ามเพิ่มสีนอกชุดนี้

import { AlertTriangle, CalendarClock, CheckCircle2, CircleDashed, Clock, Info, Layers, PackageX, PauseCircle, Scale, ShieldOff } from "lucide-react";
import type { StatusKey, StatusSignal, StatusTone } from "@/lib/jobs/board";

export const STATUS_TONE: Record<StatusTone, string> = {
  red: "border-red-300 bg-red-50 text-red-900",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  gray: "border-zinc-300 bg-zinc-50 text-zinc-800",
  blue: "border-sky-300 bg-sky-50 text-sky-900",
  green: "border-green-300 bg-green-50 text-green-900",
};

/** แถบสีซ้าย (border-l-4) ตาม tone ป้ายหลัก */
export const STATUS_BAR: Record<StatusTone, string> = {
  red: "border-l-red-600",
  amber: "border-l-amber-500",
  gray: "border-l-zinc-400",
  blue: "border-l-sky-500",
  green: "border-l-green-600",
};

export const STATUS_ICON: Record<StatusKey, typeof Info> = {
  overdue: AlertTriangle,
  dueSoon: CalendarClock,
  mismatch: Scale,
  handoff: AlertTriangle,
  stale: Clock,
  deposit: CircleDashed,
  hold: PauseCircle,
  normal: CheckCircle2,
  auto: Info,
  qty: Info,
  surplusPending: PackageX,
  underPlanned: Layers,
  goldUnguarded: ShieldOff,
};

export function StatusChip({ status, size = "secondary" }: { status: StatusSignal; size?: "primary" | "secondary" }) {
  const Icon = STATUS_ICON[status.key];
  const sz = size === "primary" ? "gap-1.5 px-2.5 py-1 text-sm font-bold" : "gap-1 px-1.5 py-0.5 text-xs font-semibold";
  return (
    <span className={`inline-flex items-center rounded-md border ${sz} ${STATUS_TONE[status.tone]}`}>
      <Icon className={`${size === "primary" ? "h-4 w-4" : "h-3 w-3"} shrink-0`} aria-hidden="true" />
      {status.label}
    </span>
  );
}
