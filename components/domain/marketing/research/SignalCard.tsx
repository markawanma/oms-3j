"use client";

// SignalCard — สัญญาณหนึ่งใบในรายการ /marketing/research
// ตัวเลขตัดสินมาจาก DB (mass_label · mass_ratio · is_unripe) — จอแสดงอย่างเดียว · วัด mass ไม่ได้ = แสดงวิวดิบ ไม่เดา
// "ประโยคเปิดตอนจับ" = snapshot (ไม่ใช่ hook ของเรา) · ลิงก์เปิดแท็บใหม่ผ่าน safeHttpUrl เท่านั้น

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PickIdeaDialog } from "@/components/domain/marketing/research/PickIdeaDialog";
import { SignalStatusDialog } from "@/components/domain/marketing/research/SignalStatusDialog";
import { useRunAction } from "@/components/domain/marketing/workflow/useRunAction";
import { setSignalStatus } from "@/lib/actions/content-signals";
import { formatThaiDay } from "@/lib/marketing/format";
import { HOOK_TYPE_LABEL, pieceStatusLabel, signalKindLabel } from "@/lib/marketing/piece-labels";
import { safeHttpUrl } from "@/lib/marketing/safe-url";
import { MASS_LABEL_TH, SIGNAL_SOURCE_LABEL, SIGNAL_STATUS_LABEL, fmtMetric } from "@/lib/marketing/signal-types";
import type { SignalRow, SignalStatus } from "@/lib/marketing/signal-types";

export function SignalCard({ signal, piece, todayTh, highlight }: { signal: SignalRow; piece?: { title: string; status: string }; todayTh: string; highlight?: boolean }) {
  const [dialog, setDialog] = useState<"pick" | "rejected" | "deferred" | null>(null);
  const { run, busy, error } = useRunAction();
  const href = safeHttpUrl(signal.url);
  const isClip = signal.kind === "reference_clip";
  const hasAnyMetric = [signal.followers, signal.views, signal.likes, signal.comments, signal.saves, signal.shares].some((n) => n !== null);
  const open = signal.status === "new" || signal.status === "deferred";

  return (
    <li id={`signal-${signal.id}`} className={`rounded-lg border bg-white p-3.5 ${highlight ? "border-primary-600 ring-1 ring-primary-600" : "border-zinc-200"}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-sm border border-zinc-300 px-2 py-0.5 font-medium text-zinc-800">{signalKindLabel(signal.kind)}</span>
        <span className="text-zinc-700">
          {SIGNAL_SOURCE_LABEL[signal.source] ?? signal.source}
          {signal.seenOn ? ` · ${formatThaiDay(signal.seenOn)}` : ""}
        </span>
        <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-800">{SIGNAL_STATUS_LABEL[signal.status as SignalStatus] ?? signal.status}</span>
        {signal.isUnripe === true && (
          <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-amber-400 px-2 py-0.5 text-amber-900">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            ยังไม่สุก (โพสต์ไม่ถึง 3 วัน)
          </span>
        )}
      </div>

      <p className="mt-1.5 text-base font-semibold break-words text-zinc-900">{signal.summary}</p>
      {signal.hookText && (
        <p className="mt-1 text-sm break-words text-zinc-800">
          <span className="text-zinc-600">ประโยคเปิดตอนจับ: </span>“{signal.hookText}”
          {signal.hookType && <span className="text-zinc-600"> · {HOOK_TYPE_LABEL[signal.hookType as keyof typeof HOOK_TYPE_LABEL] ?? signal.hookType}</span>}
        </p>
      )}
      {(signal.account || signal.platform) && (
        <p className="text-xs text-zinc-700">{[signal.platform, signal.account].filter(Boolean).join(" · ")}</p>
      )}

      {isClip && (
        <div className="mt-2 rounded-md bg-zinc-50 p-2.5 text-sm text-zinc-900 tabular-nums">
          {hasAnyMetric ? (
            <>
              <p>
                วิว {fmtMetric(signal.views)} · ผู้ติดตาม {fmtMetric(signal.followers)} · ไลก์ {fmtMetric(signal.likes)} · คอมเมนต์ {fmtMetric(signal.comments)} · บันทึก {fmtMetric(signal.saves)} · แชร์ {fmtMetric(signal.shares)}
                {signal.metricsApprox ? " (ประมาณ)" : ""}
              </p>
              <p className="mt-0.5">
                {MASS_LABEL_TH[signal.massLabel ?? "unknown"] ?? MASS_LABEL_TH.unknown}
                {signal.massRatio !== null ? ` · วิว ÷ ผู้ติดตาม ≈ ${signal.massRatio}×` : " · แสดงวิวดิบ ไม่เดา"}
              </p>
            </>
          ) : (
            <p className="text-zinc-700">ยังไม่ได้ใส่ตัวเลข — วัด mass ไม่ได้</p>
          )}
        </div>
      )}

      {signal.statusReason && <p className="mt-1.5 text-sm break-words text-zinc-800">เหตุผล: {signal.statusReason}</p>}
      {signal.status === "deferred" && signal.reviewOn && <p className="text-sm text-zinc-800">กลับมาดู {formatThaiDay(signal.reviewOn, true)}</p>}
      {signal.status === "picked" && signal.pickedStepId && (
        <p className="mt-1.5 text-sm">
          <Link href={`/marketing/pieces/${signal.pickedStepId}`} className="inline-flex min-h-11 items-center font-medium text-primary-700 underline">
            ชิ้นงาน: {piece?.title ?? "เปิดดู"}
            {piece?.status ? ` (${pieceStatusLabel(piece.status)})` : ""}
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            เปิดคลิป
            <span className="sr-only"> (แท็บใหม่)</span>
          </a>
        )}
        {open && (
          <>
            <Button type="button" onClick={() => setDialog("pick")}>
              หยิบเป็นไอเดีย
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDialog("rejected")}>
              ไม่ใช้
            </Button>
            {signal.status === "new" && (
              <Button type="button" variant="secondary" onClick={() => setDialog("deferred")}>
                เก็บไว้ก่อน
              </Button>
            )}
          </>
        )}
        {signal.status === "deferred" && (
          <Button type="button" variant="secondary" loading={busy} disabled={busy} onClick={() => void run(() => setSignalStatus(signal.id, { status: "new" }), { success: "กลับมาเป็นสัญญาณใหม่แล้ว" })}>
            ดึงกลับมาเป็นใหม่
          </Button>
        )}
        {signal.status === "rejected" && (
          <Button type="button" variant="secondary" loading={busy} disabled={busy} onClick={() => void run(() => setSignalStatus(signal.id, { status: "new" }), { success: "กลับมาเป็นสัญญาณใหม่แล้ว" })}>
            กลับมาใช้
          </Button>
        )}
      </div>

      {dialog === "pick" && <PickIdeaDialog signal={signal} onClose={() => setDialog(null)} />}
      {(dialog === "rejected" || dialog === "deferred") && <SignalStatusDialog signal={signal} mode={dialog} todayTh={todayTh} onClose={() => setDialog(null)} />}
    </li>
  );
}
