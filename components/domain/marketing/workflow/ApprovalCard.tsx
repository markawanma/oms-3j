"use client";

// ApprovalCard — การ์ดกอง 2 "รออนุมัติ" บนหน้าแรก: เห็นพอตัดสินได้จากการ์ด (hook A/B · ผลตรวจ 3 ด่าน · ข้อที่ต้องยืนยัน · storyboard ย่อ)
// 🔴 ปุ่มอนุมัติ disabled ทุกครั้งที่ can_approve=false (ค่าจาก DB ไม่คำนวณซ้ำ — F1/F7) · การ์ดไม่ใช่ลิงก์ทั้งใบ (ไม่มีปุ่มซ้อนปุ่ม)
// - อนุมัติ 1 ใบ: ไม่มีกล่องยืนยัน (D18) · ส่งกลับ: กล่องเหตุผลบังคับ · เปิดแก้: ไปหน้าชิ้นงาน (ใช้ได้บนมือถือ)
// - เวลาอ่าน: นับจากตอนการ์ดถูกแสดง (ฝั่ง client) ส่งเป็น p_review_seconds ตอนกดอนุมัติ — ข้อมูลประกอบ ไม่บล็อก

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";
import { GateBadge, AuthorBadge, PieceStatusBadge } from "@/components/domain/marketing/workflow/badges";
import { ConfirmMarkerText } from "@/components/domain/marketing/workflow/ConfirmMarkerText";
import { hookTypeLabel } from "@/components/domain/marketing/workflow/HookPair";
import { TransitionDialog } from "@/components/domain/marketing/workflow/TransitionDialog";
import { advancePiece } from "@/lib/actions/content-pieces";
import { formatThaiDay } from "@/lib/marketing/format";
import { readCaption, readSegments, readShots } from "@/lib/marketing/piece-copy";
import { CHANNEL_LABEL, CUSTOMER_GROUP_LABEL, PIECE_KIND_LABEL, TIME_SLOT_LABEL, GATE_KIND_LABEL } from "@/lib/marketing/piece-labels";
import type { ContentTypeOption, PieceRow } from "@/lib/marketing/piece-types";

function lbl(map: Record<string, string>, v: string | null): string | null {
  return v ? (map[v] ?? null) : null;
}

export function ApprovalCard({ piece, contentType }: { piece: PieceRow; contentType?: ContentTypeOption }) {
  const router = useRouter();
  const toast = useToast();
  const openedAt = useRef<number>(Date.now());
  const [sendBack, setSendBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClip = piece.pieceKind === "short_clip" || piece.pieceKind === "live_cut";
  const hooks = piece.hooks.filter((h) => h.label === "A" || h.label === "B");
  const segments = readSegments(piece.clipBrief);
  const shots = readShots(piece.clipBrief);
  const caption = readCaption(piece.contentBody);
  const when = [piece.resolvedStart ? formatThaiDay(piece.resolvedStart) : null, lbl(TIME_SLOT_LABEL, piece.timeSlot)].filter(Boolean).join(" ");
  const meta = [lbl(PIECE_KIND_LABEL, piece.pieceKind), lbl(CHANNEL_LABEL, piece.channel), when || null, lbl(CUSTOMER_GROUP_LABEL, piece.customerGroup)].filter(Boolean);
  const openHref = `/marketing/pieces/${piece.stepId}?from=inbox`;
  const needsConfirm = piece.confirmPending > 0 || piece.confirmMarkerInText;

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const seconds = Math.max(0, Math.floor((Date.now() - openedAt.current) / 1000));
      const res = await advancePiece(piece.stepId, "approved", { reviewSeconds: seconds });
      if (!res.ok) {
        setError(res.error);
        if (res.stale) router.refresh();
        return;
      }
      toast.push("อนุมัติแล้ว");
      router.refresh();
    } catch {
      setError("อนุมัติไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  const gates = [
    { k: "fact_check" as const, g: piece.gates.factCheck },
    { k: "brand_rule" as const, g: piece.gates.brandRule },
    { k: "risk_owner" as const, g: piece.gates.riskOwner },
  ];

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

      {isClip && hooks.length > 0 && (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {hooks.map((h) => (
            <li key={h.id} className="min-w-0 rounded-md border border-zinc-200 p-2">
              <p className="text-xs font-semibold text-zinc-700">
                {h.label} · {hookTypeLabel(h.hookType)}
              </p>
              <p className="mt-0.5 line-clamp-3 break-words text-sm text-zinc-900">
                <ConfirmMarkerText text={h.text} />
              </p>
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="ผลตรวจ 3 ด่าน">
        {gates.map(({ k, g }) => (
          <li key={k}>
            <GateBadge status={g?.status ?? null} label={GATE_KIND_LABEL[k]} />
          </li>
        ))}
      </ul>

      {needsConfirm && (
        <p className="mt-2 flex items-start gap-2 rounded-md bg-amber-100 p-2.5 text-sm text-amber-900 ring-1 ring-amber-500">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <strong>ต้องยืนยัน{piece.confirmPending > 0 ? ` ${piece.confirmPending} จุด` : ""}</strong> — เปิดชิ้นงานเพื่อตอบก่อนอนุมัติ
          </span>
        </p>
      )}

      {(isClip ? segments.length + shots.length > 0 : !!caption) && (
        <details className="mt-1">
          <summary className="flex min-h-11 cursor-pointer select-none items-center text-sm font-medium text-primary-700 underline underline-offset-2">
            {isClip ? "ดู storyboard" : "ดูเนื้อหา"}
          </summary>
          <div className="space-y-2 pb-1 text-sm text-zinc-800">
            {isClip ? (
              <>
                {segments.length > 0 && (
                  <ul className="space-y-1">
                    {segments.map((s) => (
                      <li key={s.role} className="break-words">
                        <ConfirmMarkerText text={s.line} />
                      </li>
                    ))}
                  </ul>
                )}
                {shots.length > 0 && (
                  <ol className="list-decimal space-y-1 pl-5">
                    {shots.map((s) => (
                      <li key={s.id} className="break-words">
                        <ConfirmMarkerText text={s.desc || "(ไม่มีคำอธิบาย)"} />
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : (
              <p className="break-words">
                <ConfirmMarkerText text={piece.contentBody} />
              </p>
            )}
          </div>
        </details>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Button type="button" variant="secondary" onClick={() => setSendBack(true)} disabled={busy}>
          ส่งกลับ
        </Button>
        <Link
          href={openHref}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-2 text-base font-medium text-zinc-700 hover:bg-zinc-50"
        >
          เปิดแก้
        </Link>
        <Button type="button" onClick={() => void approve()} loading={busy} disabled={!piece.canApprove || busy}>
          อนุมัติ
        </Button>
      </div>
      {!piece.canApprove && <p className="mt-1.5 text-xs text-zinc-700">อนุมัติได้เมื่อผ่านครบทุกอย่าง — เปิดชิ้นงานเพื่อดูว่าเหลืออะไร</p>}

      {sendBack && (
        <TransitionDialog
          open
          variant="sendBack"
          onClose={() => setSendBack(false)}
          onSubmit={(reason) => advancePiece(piece.stepId, "drafting", { reason })}
        />
      )}
    </li>
  );
}
