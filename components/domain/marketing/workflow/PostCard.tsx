"use client";

// PostCard — การ์ดกอง 1 "วันนี้ต้องโพสต์" (approved/produced ที่ถึงวันแล้ว)
// - ปุ่มหลัก 1 อันตามสถานะ (primaryActionFor): "ถ่ายแล้ว" / "โพสต์แล้ว" (เปิด PostedSheet) / "กลับมาทำต่อ"
// - เลยกำหนดแล้วยังไม่วางลิงก์ (flag_no_link_overdue จาก DB — brief 0.2) → แถบแดงบนการ์ดเดียวกัน ไม่แยกการ์ดปลอม
// - คัดลอกแคปชัน: แสดงเฉพาะเมื่อมีแคปชัน (content_body) · ไม่ประกอบแคปชันจาก segments

import { useState } from "react";
import Link from "next/link";
import { Link2Off } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useRunAction } from "@/components/domain/marketing/workflow/useRunAction";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";
import { AuthorBadge, PieceStatusBadge } from "@/components/domain/marketing/workflow/badges";
import { CopyButton } from "@/components/domain/marketing/workflow/CopyButton";
import { PostedSheet } from "@/components/domain/marketing/workflow/PostedSheet";
import { advancePiece } from "@/lib/actions/content-pieces";
import { daysBetween, formatThaiDay } from "@/lib/marketing/format";
import { readCaption } from "@/lib/marketing/piece-copy";
import { CHANNEL_LABEL, PIECE_KIND_LABEL, TIME_SLOT_LABEL, primaryActionFor } from "@/lib/marketing/piece-labels";
import type { ContentTypeOption, PieceRow } from "@/lib/marketing/piece-types";

function lbl(map: Record<string, string>, v: string | null): string | null {
  return v ? (map[v] ?? null) : null;
}

export function PostCard({
  piece,
  contentType,
  overdueNoLink,
  todayTh,
}: {
  piece: PieceRow;
  contentType?: ContentTypeOption;
  overdueNoLink: boolean;
  todayTh: string;
}) {
  const [sheet, setSheet] = useState(false);
  const { run, busy, error } = useRunAction();

  const primary = primaryActionFor({ effective: piece.effectiveStatus, pieceKind: piece.pieceKind, footageStatus: piece.footageStatus });
  const caption = readCaption(piece.contentBody);
  const lateDays = piece.resolvedStart ? daysBetween(piece.resolvedStart, todayTh) : null;
  const when = [piece.resolvedStart ? formatThaiDay(piece.resolvedStart) : null, lbl(TIME_SLOT_LABEL, piece.timeSlot), piece.startTime ? `${piece.startTime} น.` : null]
    .filter(Boolean)
    .join(" ");
  const meta = [lbl(PIECE_KIND_LABEL, piece.pieceKind), lbl(CHANNEL_LABEL, piece.channel), when || null].filter(Boolean);
  const openHref = `/marketing/pieces/${piece.stepId}?from=inbox`;

  function advance(to: string, ok: string) {
    return run(() => advancePiece(piece.stepId, to), { success: ok });
  }

  function onPrimary() {
    if (primary.key === "mark_posted") setSheet(true);
    else if (primary.key === "mark_produced") void advance("produced", "บันทึกว่าถ่ายแล้ว");
    else if (primary.key === "resume") void advance("resume", "กลับมาทำต่อแล้ว");
  }

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {contentType && <ContentTypeChip contentType={contentType} />}
        <PieceStatusBadge status={piece.effectiveStatus} />
        {piece.draftedByAi && <AuthorBadge kind="ai" />}
      </div>

      <Link href={openHref} className="mt-1 block min-h-11 break-words py-1 text-base font-semibold text-zinc-900 hover:underline">
        {piece.title}
      </Link>
      {meta.length > 0 && <p className="break-words text-sm text-zinc-700">{meta.join(" · ")}</p>}

      {overdueNoLink && (
        <p className="mt-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-900">
          <Link2Off className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <strong>ถึงเวลาโพสต์แล้ว · ยังไม่วางลิงก์</strong>
            {lateDays !== null && lateDays > 0 && <span className="tabular-nums"> (เลยมา {lateDays} วัน)</span>}
          </span>
        </p>
      )}
      {piece.holdReason && <p className="mt-2 rounded-md bg-orange-50 p-2.5 text-sm text-orange-900">รอเงื่อนไข: {piece.holdReason}</p>}

      {error && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        {caption ? <CopyButton text={caption} label="คัดลอกแคปชัน" /> : <span aria-hidden="true" />}
        {primary.key !== "none" ? (
          <Button type="button" onClick={onPrimary} loading={busy} disabled={busy}>
            {primary.label}
          </Button>
        ) : (
          <Link href={openHref} className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-2 text-base font-medium text-zinc-700 hover:bg-zinc-50">
            เปิดชิ้นงาน
          </Link>
        )}
      </div>

      {sheet && (
        <PostedSheet open stepId={piece.stepId} title={piece.title} pieceKind={piece.pieceKind} posts={piece.posts} hooks={piece.hooks} onClose={() => setSheet(false)} />
      )}
    </li>
  );
}
