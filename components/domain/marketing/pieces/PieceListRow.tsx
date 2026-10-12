"use client";

// PieceListRow — แถวชิ้นงานในหน้า "ชิ้นงานทั้งหมด" · ชิ้นที่ยกเลิกมีปุ่ม "กู้คืน" (กล่องเหตุผลบังคับ → advance restore · DB คืนไปสถานะก่อนยกเลิก)

import { useState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";
import { PieceStatusBadge } from "@/components/domain/marketing/workflow/badges";
import { TransitionDialog } from "@/components/domain/marketing/workflow/TransitionDialog";
import { advancePiece } from "@/lib/actions/content-pieces";
import { formatThaiDay } from "@/lib/marketing/format";
import { CHANNEL_LABEL, PIECE_KIND_LABEL } from "@/lib/marketing/piece-labels";
import type { ContentTypeOption, PieceRow } from "@/lib/marketing/piece-types";

function lbl(map: Record<string, string>, v: string | null): string | null {
  return v ? (map[v] ?? null) : null;
}

export function PieceListRow({ piece, contentType }: { piece: PieceRow; contentType?: ContentTypeOption }) {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const cancelled = piece.pieceStatus === "cancelled";
  const when = piece.resolvedStart
    ? piece.resolvedEnd && piece.resolvedEnd !== piece.resolvedStart
      ? `${formatThaiDay(piece.resolvedStart)} – ${formatThaiDay(piece.resolvedEnd)}`
      : formatThaiDay(piece.resolvedStart)
    : "ยังไม่ตั้งวัน";
  const meta = [lbl(PIECE_KIND_LABEL, piece.pieceKind), lbl(CHANNEL_LABEL, piece.channel), when, piece.campaignName].filter(Boolean);

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <PieceStatusBadge status={piece.effectiveStatus} />
        {contentType && <ContentTypeChip contentType={contentType} />}
      </div>
      <Link
        href={`/marketing/pieces/${piece.stepId}?from=pieces`}
        className={`mt-1 block min-h-11 py-1 text-base font-semibold break-words hover:underline ${cancelled ? "text-zinc-600" : "text-zinc-900"}`}
      >
        {piece.title}
      </Link>
      <p className="text-sm break-words text-zinc-700">{meta.join(" · ")}</p>
      {piece.holdReason && <p className="mt-1.5 rounded-md bg-orange-50 p-2 text-sm text-orange-900">รอเงื่อนไข: {piece.holdReason}</p>}
      {cancelled && (
        <div className="mt-2">
          <Button type="button" variant="secondary" onClick={() => setRestoreOpen(true)}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            กู้คืน
          </Button>
        </div>
      )}
      {restoreOpen && (
        <TransitionDialog open variant="restore" onClose={() => setRestoreOpen(false)} onSubmit={(reason) => advancePiece(piece.stepId, "restore", { reason })} />
      )}
    </li>
  );
}
