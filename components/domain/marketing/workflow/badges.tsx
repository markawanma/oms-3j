// components/domain/marketing/workflow/badges.tsx — ป้ายย่อยของ workflow ชิ้นงาน (server-safe, ไม่มี hook)
// content-ui-build-plan.md §5.1: ข้อความอยู่คู่ไอคอนเสมอ (ไอคอน aria-hidden) · ไม่พึ่งสีอย่างเดียว

import {
  AlertTriangle,
  Ban,
  BarChart3,
  Bot,
  CalendarCheck,
  CheckCircle2,
  CircleOff,
  Clapperboard,
  Clock,
  Eye,
  Hourglass,
  Lightbulb,
  MinusCircle,
  Pause,
  Pencil,
  PenLine,
  Send,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import {
  GATE_STATUS_LABEL,
  PIECE_STATUS_LABEL,
  PIECE_STATUS_TONE,
  gateStatusLabel,
  pieceStatusLabel,
} from "@/lib/marketing/piece-labels";
import type { EffectivePieceStatus, GateStatus } from "@/lib/marketing/piece-labels";

const STATUS_ICON: Record<EffectivePieceStatus, LucideIcon> = {
  idea: Lightbulb,
  planned: CalendarCheck,
  drafting: PenLine,
  in_review: Eye,
  approved: CheckCircle2,
  produced: Clapperboard,
  posted: Send,
  measuring: Hourglass,
  measured: BarChart3,
  missed_measure: CircleOff,
  on_hold: Pause,
  cancelled: Ban,
};

/** ป้ายสถานะ 9+3 แบบ (ตาราง tone §5.1) — รับ effective_piece_status จาก view */
export function PieceStatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const known = status in PIECE_STATUS_LABEL;
  const key = (known ? status : "idea") as EffectivePieceStatus;
  const Icon = known ? STATUS_ICON[key] : AlertTriangle;
  const label = known ? PIECE_STATUS_LABEL[key] : pieceStatusLabel(status);
  // วัดผลแล้ว: พื้นเข้ม (Badge ไม่มี tone นี้) · พลาดรอบ: เส้นประ · ยกเลิก: ขีดฆ่า
  const extra =
    key === "measured" && known
      ? "!bg-indigo-700 !text-white"
      : key === "missed_measure" && known
        ? "border border-dashed border-zinc-400"
        : key === "cancelled" && known
          ? "line-through"
          : "";
  return (
    <Badge tone={known ? PIECE_STATUS_TONE[key] : "slate"} className={`${extra} ${className}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
    </Badge>
  );
}

/** ป้ายผู้เขียน ≠ สถานะ (5.3): outline เส้นบางพื้นขาว ไม่ใช้ tone ทึบ */
export function AuthorBadge({ kind }: { kind: "ai" | "human" }) {
  const Icon = kind === "ai" ? Bot : Pencil;
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-zinc-300 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 whitespace-nowrap">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {kind === "ai" ? "ร่างโดย AI" : "แก้โดยคน"}
    </span>
  );
}

/** ตัวเลขนับกอง (pill ดำ) */
export function CountPill({ n, label }: { n: number; label?: string }) {
  return (
    <span
      className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-zinc-900 px-2 text-xs font-bold tabular-nums text-white"
      aria-label={label ? `${label} ${n}` : undefined}
    >
      {n.toLocaleString("th-TH")}
    </span>
  );
}

const GATE_STYLE: Record<GateStatus, { cls: string; Icon: LucideIcon }> = {
  passed: { cls: "text-green-800", Icon: CheckCircle2 },
  blocked: { cls: "text-red-800", Icon: AlertTriangle },
  pending: { cls: "text-amber-800", Icon: Clock },
  na: { cls: "text-zinc-600", Icon: MinusCircle },
};

/** สถานะด่าน: ไอคอน + ข้อความ (ด่านที่ยังไม่มีแถว = รอตรวจ) */
export function GateBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  const key = (status && status in GATE_STATUS_LABEL ? status : "pending") as GateStatus;
  const { cls, Icon } = GATE_STYLE[key];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${cls}`}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label ? `${label}: ` : ""}
      {gateStatusLabel(status)}
    </span>
  );
}
