"use client";

// CalendarPieceCard — การ์ดชิ้นงานบนปฏิทิน (board D): ช่วงเวลา · ป้ายประเภท · ชื่อ · ช่องทาง·ชนิด · ป้ายสถานะ + ธง (ข้อความ+ไอคอน)
// - กดการ์ด → หน้าชิ้นงาน · เลื่อนวัน = ปุ่ม "เลื่อน" (เปิดกล่องเหตุผลบังคับ) — ไม่มีลากวาง (D7)
// - ธงมาจากคอลัมน์ flag_* ของ v_content_piece_calendar ทั้งหมด ไม่คำนวณใน client (F7)
// - ปุ่มเลื่อนเป็นพี่น้องของลิงก์ (ไม่ซ้อนปุ่มในลิงก์)

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, CalendarClock, Check, Link2Off, Pause, Video } from "lucide-react";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";
import { PieceStatusBadge } from "@/components/domain/marketing/workflow/badges";
import { DeferDialog } from "@/components/domain/marketing/workflow/TransitionDialog";
import { deferPiece } from "@/lib/actions/content-pieces";
import { isMultiDay, slotText } from "@/lib/marketing/calendar-view";
import { formatThaiDay } from "@/lib/marketing/format";
import { CHANNEL_LABEL, PIECE_KIND_LABEL } from "@/lib/marketing/piece-labels";
import type { ContentTypeRow } from "@/lib/marketing/content-types";
import type { PieceRow } from "@/lib/marketing/piece-types";

/** ชิ้นที่เลื่อนวันได้: อยู่ planned..produced และมีวัน (idea/posted/cancelled DB ปฏิเสธ — ไม่แสดงปุ่มที่ฟ้อง) */
export function canDeferPiece(p: Pick<PieceRow, "pieceStatus" | "resolvedStart">): boolean {
  return p.resolvedStart !== null && ["planned", "drafting", "in_review", "approved", "produced"].includes(p.pieceStatus);
}

function Flag({ icon: Icon, children, tone }: { icon: typeof Check; children: string; tone: "zinc" | "amber" | "red" | "green" }) {
  const cls = {
    zinc: "bg-zinc-100 text-zinc-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-900",
    green: "bg-green-100 text-green-900",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

export function CalendarPieceCard({
  piece,
  contentTypes,
  continuation = false,
  todayTh,
}: {
  piece: PieceRow;
  contentTypes: ContentTypeRow[];
  continuation?: boolean;
  todayTh: string;
}) {
  const [deferOpen, setDeferOpen] = useState(false);
  const contentType = piece.contentTypeCode ? contentTypes.find((c) => c.code === piece.contentTypeCode) : undefined;
  const slot = slotText(piece);
  const channel = piece.channel ? ((CHANNEL_LABEL as Record<string, string>)[piece.channel] ?? null) : null;
  const kind = piece.pieceKind ? ((PIECE_KIND_LABEL as Record<string, string>)[piece.pieceKind] ?? null) : null;
  const hasFootage = piece.pieceStatus !== "posted" && (piece.footageStatus === "has_footage" || piece.footageStatus === "shot");
  const defer = canDeferPiece(piece);

  return (
    <div className="relative rounded-lg border border-zinc-200 bg-white hover:border-zinc-400">
      <Link
        href={`/marketing/pieces/${piece.stepId}?from=calendar`}
        className={`block space-y-1.5 p-2.5 ${defer ? "pr-12" : ""}`}
        aria-label={`เปิดชิ้นงาน ${piece.title}`}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          {slot && <span className="text-xs font-semibold text-zinc-700">{slot}</span>}
          {continuation && <span className="rounded-sm border border-zinc-300 px-1 text-xs text-zinc-700">ต่อเนื่อง</span>}
          {contentType && <ContentTypeChip contentType={contentType} className="max-w-full" />}
        </span>
        <span title={piece.title} className="block break-words text-sm font-semibold leading-snug text-zinc-900 lg:line-clamp-4">{piece.title}</span>
        {(channel || kind) && <span className="block text-xs text-zinc-700">{[channel, kind].filter(Boolean).join(" · ")}</span>}
        {isMultiDay(piece) && (
          <span className="block text-xs font-medium text-zinc-800">
            ช่วง {formatThaiDay(piece.resolvedStart)} – {formatThaiDay(piece.resolvedEnd)}
          </span>
        )}
        {piece.expectedHostLabel && <span className="block text-xs text-zinc-600">โฮสต์ที่คาด: {piece.expectedHostLabel}</span>}
        <span className="flex flex-wrap items-center gap-1">
          <PieceStatusBadge status={piece.effectiveStatus} />
          {piece.flagNeedsShoot && <Flag icon={Video} tone="zinc">ต้องถ่าย</Flag>}
          {hasFootage && !piece.flagNeedsShoot && <Flag icon={Check} tone="green">มีภาพแล้ว</Flag>}
          {piece.flagOnHold && <Flag icon={Pause} tone="amber">รอเงื่อนไข</Flag>}
          {piece.flagConfirmPending && <Flag icon={AlertCircle} tone="amber">ต้องยืนยัน</Flag>}
          {piece.flagNoLinkOverdue && <Flag icon={Link2Off} tone="red">ยังไม่วางลิงก์</Flag>}
        </span>
        {piece.flagOnHold && piece.holdReason && <span className="block break-words text-xs text-zinc-700">รอ: {piece.holdReason}</span>}
      </Link>

      {defer && (
        <>
          <button
            type="button"
            onClick={() => setDeferOpen(true)}
            aria-label={`เลื่อนวัน ${piece.title}`}
            className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100"
          >
            <CalendarClock className="h-5 w-5" aria-hidden="true" />
          </button>
          {deferOpen && (
            <DeferDialog
              open
              todayTh={todayTh}
              currentDate={piece.resolvedStart}
              onClose={() => setDeferOpen(false)}
              onSubmit={(date, reason, time) => deferPiece(piece.stepId, date, reason, time)}
            />
          )}
        </>
      )}
    </div>
  );
}
