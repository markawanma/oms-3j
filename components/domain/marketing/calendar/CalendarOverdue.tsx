"use client";

// CalendarOverdue — แถบ "ค้างจากก่อนหน้า" (board D): ชิ้นที่วันผ่านไปแล้วแต่ยังไม่โพสต์/ยังไม่จบ + ปุ่ม เลื่อน / ยกเลิก
// เลื่อน = กล่องเหตุผลบังคับ (content_piece_defer) · ยกเลิก = กล่องเหตุผลบังคับ (advance cancelled) · ไม่มีปุ่มที่ฟ้อง error
// สถานะ/ธงมาจาก view — ที่นี่ไม่ตัดสินว่า "ค้าง" (query ฝั่ง server กรองแล้ว)

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DeferDialog, TransitionDialog } from "@/components/domain/marketing/workflow/TransitionDialog";
import { advancePiece, deferPiece } from "@/lib/actions/content-pieces";
import { formatThaiDay } from "@/lib/marketing/format";
import { pieceStatusLabel } from "@/lib/marketing/piece-labels";
import { canDeferPiece } from "@/components/domain/marketing/calendar/CalendarPieceCard";
import type { PieceRow } from "@/lib/marketing/piece-types";

const SHOW = 3;

export function CalendarOverdue({ pieces, todayTh }: { pieces: PieceRow[]; todayTh: string }) {
  const [defer, setDefer] = useState<PieceRow | null>(null);
  const [cancel, setCancel] = useState<PieceRow | null>(null);
  if (pieces.length === 0) return null;
  const shown = pieces.slice(0, SHOW);

  return (
    <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        ค้างจากก่อนหน้า ({pieces.length})
      </p>
      <ul className="mt-2 space-y-2">
        {shown.map((p) => (
          <li key={p.stepId} className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/marketing/pieces/${p.stepId}?from=calendar`} className="min-h-11 min-w-0 flex-1 py-2 hover:underline">
              <span className="font-medium break-words">{p.title}</span>
              <span className="block text-xs">
                {formatThaiDay(p.resolvedStart)} · {pieceStatusLabel(p.effectiveStatus)} · ยังไม่โพสต์
              </span>
            </Link>
            <span className="flex gap-2">
              {canDeferPiece(p) && (
                <Button type="button" variant="secondary" onClick={() => setDefer(p)}>
                  เลื่อน
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={() => setCancel(p)}>
                ยกเลิก
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {pieces.length > shown.length && <p className="mt-2 text-xs">และอีก {pieces.length - shown.length} ชิ้น — ดูได้ที่มุมมอง “รายการ” (กลุ่มค้างจากก่อนหน้า)</p>}

      {defer && (
        <DeferDialog
          open
          todayTh={todayTh}
          currentDate={defer.resolvedStart}
          onClose={() => setDefer(null)}
          onSubmit={(date, reason, time) => deferPiece(defer.stepId, date, reason, time)}
        />
      )}
      {cancel && (
        <TransitionDialog open variant="cancel" onClose={() => setCancel(null)} onSubmit={(reason) => advancePiece(cancel.stepId, "cancelled", { reason })} />
      )}
    </div>
  );
}
