"use client";

// ShootPieceCard — หนึ่งชิ้นในกลุ่มสถานที่ของรอบถ่าย: ช็อต (checkbox ≥44px) · "ดูบท" · "เลื่อนชิ้นนี้"
// ติ๊กช็อต = toggleShot (RPC เดิม ทำได้หลังอนุมัติ) · ติ๊กแบบ optimistic แล้วย้อนกลับถ้า DB ปฏิเสธ · เลื่อน = กล่องเหตุผลบังคับ (content_piece_defer)
// ไม่มีปุ่ม "ใช้ภาพ AI แทน" — ไม่ถ่าย = เลื่อน

import { useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";
import { DeferDialog } from "@/components/domain/marketing/workflow/TransitionDialog";
import { useRunAction } from "@/components/domain/marketing/workflow/useRunAction";
import { deferPiece, toggleShot } from "@/lib/actions/content-pieces";
import { formatThaiDay } from "@/lib/marketing/format";
import { CHANNEL_LABEL, PIECE_KIND_LABEL } from "@/lib/marketing/piece-labels";
import { doneKey, isShotDone, remainingShots } from "@/lib/marketing/shoot";
import type { DoneMap, ShootItem } from "@/lib/marketing/shoot";
import type { ContentTypeOption } from "@/lib/marketing/piece-types";

export function ShootPieceCard({
  item,
  contentType,
  local,
  onLocal,
  todayTh,
}: {
  item: ShootItem;
  contentType?: ContentTypeOption;
  local: DoneMap;
  onLocal: (stepId: string, shotId: string, done: boolean | undefined) => void;
  todayTh: string;
}) {
  const { piece, shots } = item;
  const { run, busy, error } = useRunAction();
  const [deferOpen, setDeferOpen] = useState(false);
  const canToggle = !!piece.artifactId;
  const left = remainingShots(item, local);
  const meta = [
    (PIECE_KIND_LABEL as Record<string, string>)[piece.pieceKind ?? ""],
    (CHANNEL_LABEL as Record<string, string>)[piece.channel ?? ""],
    piece.resolvedStart ? formatThaiDay(piece.resolvedStart) : null,
    piece.expectedHostLabel,
  ].filter(Boolean);

  async function toggle(shotId: string, done: boolean) {
    if (!piece.artifactId) return;
    onLocal(piece.stepId, shotId, done);
    const res = await run(() => toggleShot(piece.stepId, piece.artifactId as string, shotId, done), { refresh: false });
    if (!res.ok) onLocal(piece.stepId, shotId, undefined); // ย้อนกลับเป็นค่าจาก server
  }

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {contentType && <ContentTypeChip contentType={contentType} />}
        {piece.shootMinutesEst !== null && (
          <span className="inline-flex items-center gap-1 text-xs text-zinc-700 tabular-nums">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />≈{piece.shootMinutesEst} นาที
          </span>
        )}
      </div>
      <h4 className="mt-1 text-base font-semibold break-words text-zinc-900">{piece.title}</h4>
      <p className="text-xs break-words text-zinc-700">{meta.join(" · ")}</p>
      {piece.shootNote && <p className="mt-1 text-sm break-words text-zinc-800">หมายเหตุ: {piece.shootNote}</p>}

      {shots.length === 0 ? (
        <p className="mt-2 rounded-md bg-zinc-50 p-2 text-sm text-zinc-700">ชิ้นนี้ไม่มี shot list — ถ่ายตามบทแล้วติ๊ก “ถ่ายครบ” ด้านล่าง</p>
      ) : (
        <ul className="mt-2 space-y-1" aria-label={`ช็อตของ ${piece.title}`}>
          {shots.map((s) => {
            const done = isShotDone(item, s, local);
            const id = `shot-${piece.stepId}-${s.id}`;
            return (
              <li key={s.id}>
                <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-1 py-2 hover:bg-zinc-50">
                  <input
                    id={id}
                    type="checkbox"
                    checked={done}
                    disabled={busy || !canToggle}
                    onChange={(e) => void toggle(s.id, e.target.checked)}
                    className="mt-0.5 h-6 w-6 shrink-0 accent-green-700"
                  />
                  <span className={`min-w-0 text-sm break-words ${done ? "text-zinc-600 line-through" : "text-zinc-900"}`}>{s.desc}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!canToggle && shots.length > 0 && <p className="text-xs text-amber-900">ชิ้นนี้ติ๊กช็อตจากหน้านี้ไม่ได้ (ไม่มีเอกสารบท) — เปิด “ดูบท”</p>}
      {error && (
        <p role="alert" className="mt-1 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link
          href={`/marketing/pieces/${piece.stepId}?from=shoot`}
          className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
        >
          ดูบท
        </Link>
        <Button type="button" variant="secondary" onClick={() => setDeferOpen(true)} className="print:hidden">
          เลื่อนชิ้นนี้
        </Button>
        {shots.length > 0 && <span className="text-xs text-zinc-700 tabular-nums">{left === 0 ? "ติ๊กครบแล้ว" : `เหลือ ${left} ช็อต`}</span>}
      </div>

      {deferOpen && (
        <DeferDialog
          open
          todayTh={todayTh}
          currentDate={piece.resolvedStart}
          onClose={() => setDeferOpen(false)}
          onSubmit={(date, reason, time) => deferPiece(piece.stepId, date, reason, time)}
        />
      )}
    </li>
  );
}
