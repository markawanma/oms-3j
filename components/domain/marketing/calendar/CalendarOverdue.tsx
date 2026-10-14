"use client";

// CalendarOverdue — แถบ "ค้างจากก่อนหน้า" (board D): ชิ้นที่วันผ่านไปแล้วแต่ยังไม่โพสต์/ยังไม่จบ + ปุ่ม เลื่อน / ยกเลิก
// เลื่อน = กล่องเหตุผลบังคับ (content_piece_defer) · ยกเลิก = กล่องเหตุผลบังคับ (advance cancelled) · ไม่มีปุ่มที่ฟ้อง error
// สถานะ/ธงมาจาก view — ที่นี่ไม่ตัดสินว่า "ค้าง" (query ฝั่ง server กรองแล้ว)
// มือถือ: พับเหลือบรรทัดเดียว "ค้าง n ชิ้น ▸" (ให้รายการวันโผล่เร็วขึ้น) · PC: แสดงรายการเต็ม

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DeferDialog, TransitionDialog } from "@/components/domain/marketing/workflow/TransitionDialog";
import { advancePiece, deferPiece } from "@/lib/actions/content-pieces";
import { formatThaiDay } from "@/lib/marketing/format";
import { pieceStatusLabel } from "@/lib/marketing/piece-labels";
import { canDeferPiece } from "@/components/domain/marketing/calendar/CalendarPieceCard";
import { OVERDUE_FETCH_LIMIT } from "@/lib/marketing/calendar-types";
import type { PieceRow } from "@/lib/marketing/piece-types";

const SHOW = 3;

const ALL_LINK = "/marketing/pieces";

function Items({
  pieces,
  showAll,
  onDefer,
  onCancel,
}: {
  pieces: PieceRow[];
  showAll: boolean;
  onDefer: (p: PieceRow) => void;
  onCancel: (p: PieceRow) => void;
}) {
  const shown = showAll ? pieces : pieces.slice(0, SHOW);
  return (
    <>
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
                <Button type="button" variant="secondary" onClick={() => onDefer(p)}>
                  เลื่อน
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={() => onCancel(p)}>
                ยกเลิก
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {pieces.length > shown.length && (
        <p className="mt-2 text-xs">
          และอีก {pieces.length - shown.length} ชิ้น —{" "}
          <Link href={ALL_LINK} className="inline-flex min-h-11 items-center font-semibold underline">
            ดูทั้งหมดที่ชิ้นงานทั้งหมด
          </Link>
        </p>
      )}
      {/* ถึงเพดานที่ action ส่งมา = อาจมีมากกว่านี้ — ไม่ตัดเงียบ */}
      {showAll && pieces.length >= OVERDUE_FETCH_LIMIT && (
        <p className="mt-2 text-xs">
          แสดง {pieces.length} ชิ้นล่าสุด — อาจมีมากกว่านี้{" "}
          <Link href={ALL_LINK} className="inline-flex min-h-11 items-center font-semibold underline">
            ดูทั้งหมดที่ชิ้นงานทั้งหมด
          </Link>
        </p>
      )}
    </>
  );
}

/** showAll = มุมมองรายการ: แสดงครบทุกชิ้นที่โหลดมา (ไม่ย่อเหลือ 3) */
export function CalendarOverdue({ pieces, todayTh, showAll = false }: { pieces: PieceRow[]; todayTh: string; showAll?: boolean }) {
  const [defer, setDefer] = useState<PieceRow | null>(null);
  const [cancel, setCancel] = useState<PieceRow | null>(null);
  if (pieces.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 text-sm text-amber-900">
      {/* PC: รายการเต็ม */}
      <div className="hidden p-3 lg:block">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          ค้างจากก่อนหน้า ({pieces.length})
        </p>
        <Items pieces={pieces} showAll={showAll} onDefer={setDefer} onCancel={setCancel} />
      </div>
      {/* มือถือ/แท็บเล็ต: พับเหลือบรรทัดเดียว */}
      <details className="lg:hidden">
        <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 px-3 font-semibold">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          ค้าง {pieces.length} ชิ้น
          <span aria-hidden="true">▸</span>
        </summary>
        <div className="px-3 pb-3">
          <Items pieces={pieces} showAll={showAll} onDefer={setDefer} onCancel={setCancel} />
        </div>
      </details>

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
