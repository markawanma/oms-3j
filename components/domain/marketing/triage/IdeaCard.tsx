"use client";

// IdeaCard — การ์ดไอเดียหนึ่งใบในหน้า "คัดไอเดีย" (/marketing/triage · แผน §4 P1b ข้อ 1)
//   ✓ ทำ  : ต้องเลือกวันเอง (ไม่เลือกให้) → chooseIdea = setPlan({date}) + advance planned · DB ตัดสินว่าวางแผนได้ไหม (55000 → แสดงสิ่งที่ขาด + ปุ่ม "แก้แผน")
//   ✗ ไม่ทำ: กล่องเหตุผล ≥3 → cancelled   ·   ↷ เลื่อน: กล่องเหตุผล (ค่าเริ่มต้นแก้ได้) → hold overlay
//   LINE เกินโควตา/เหลือ 0 (ตัวเลขจาก v_line_quota_28d) → กล่องเตือนก่อน ✓ แต่ยืนยันทำต่อได้ ไม่บล็อก
// ตัวเลขฐาน/เกณฑ์แสดงดิบ ไม่ใส่ % (Q1a) · ที่มาจากสัญญาณ (ข้อความ summary เป็นข้อความธรรมดา ไม่ render เป็น HTML)

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Pencil, Redo2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";
import { AuthorBadge } from "@/components/domain/marketing/workflow/badges";
import { PlanForm } from "@/components/domain/marketing/workflow/PlanForm";
import { TransitionDialog } from "@/components/domain/marketing/workflow/TransitionDialog";
import { useRunAction } from "@/components/domain/marketing/workflow/useRunAction";
import { chooseIdea, holdIdea, skipIdea, unchooseIdea, resumeIdea } from "@/lib/actions/content-triage";
import { formatThaiDay } from "@/lib/marketing/format";
import {
  CHANNEL_LABEL,
  CUSTOMER_GROUP_LABEL,
  FOOTAGE_STATUS_LABEL,
  HOOK_TYPE_LABEL,
  METRIC_CODE_LABEL,
  PASS_OP_LABEL,
  PIECE_KIND_LABEL,
  signalKindLabel,
} from "@/lib/marketing/piece-labels";
import { baselineLine, dayOptionLabel, distinctHookTypes, needsLineConfirm, parsePlanBlockers } from "@/lib/marketing/triage";
import type { ContentTypeOption, HostOption, LineQuota, PieceRow, SignalOrigin } from "@/lib/marketing/piece-types";

const SELECT =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

function lbl(map: Record<string, string>, v: string | null): string | null {
  return v ? (map[v] ?? null) : null;
}

export interface IdeaCardShared {
  weekDays: string[];
  dayCounts: Record<string, number>;
  lineQuota: LineQuota | null;
  hosts: HostOption[];
  contentTypes: ContentTypeOption[];
  todayTh: string;
}

function focusListHeading() {
  // การ์ดหายหลัง refresh — คืนโฟกัสให้หัวรายการ (ไม่ให้โฟกัสหลุดไปต้นหน้า)
  document.getElementById("triage-list-heading")?.focus();
}

export function IdeaCard({
  piece,
  contentType,
  signal,
  shared,
}: {
  piece: PieceRow;
  contentType?: ContentTypeOption;
  signal?: SignalOrigin;
  shared: IdeaCardShared;
}) {
  const { run, busy, error } = useRunAction();
  const [day, setDay] = useState("");
  const [lineConfirm, setLineConfirm] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  const kind = lbl(PIECE_KIND_LABEL, piece.pieceKind);
  const meta = [kind, lbl(CHANNEL_LABEL, piece.channel), lbl(CUSTOMER_GROUP_LABEL, piece.customerGroup)].filter(Boolean);
  const metric = lbl(METRIC_CODE_LABEL, piece.metricCode);
  const base = baselineLine(piece, PASS_OP_LABEL);
  const hookTypes = distinctHookTypes(piece);
  const isClip = piece.pieceKind === "short_clip" || piece.pieceKind === "live_cut";
  const blockers = parsePlanBlockers(error);
  const q = shared.lineQuota;

  async function doChoose() {
    setLineConfirm(false);
    if (!day) return;
    const res = await run(() => chooseIdea(piece.stepId, day), { success: `ลงปฏิทินแล้ว · ${formatThaiDay(day)}` });
    if (res.ok) focusListHeading();
  }

  function onChoose() {
    if (!day) return;
    if (needsLineConfirm(piece, q)) setLineConfirm(true);
    else void doChoose();
  }

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {contentType && <ContentTypeChip contentType={contentType} />}
        {piece.draftedByAi && <AuthorBadge kind="ai" />}
        {piece.resolvedStart && (
          <span className="text-xs text-zinc-700">วันที่ตั้งไว้เดิม {formatThaiDay(piece.resolvedStart)} — ยังเก็บไว้ แต่ไม่แสดงในปฏิทินจนกว่าจะกด “ทำ”</span>
        )}
      </div>

      <h3 className="mt-1.5 text-base font-semibold break-words text-zinc-900">
        <Link href={`/marketing/pieces/${piece.stepId}?from=triage`} className="block min-h-11 py-1.5 hover:underline">
          {piece.title}
        </Link>
      </h3>
      {meta.length > 0 && <p className="text-sm break-words text-zinc-700">{meta.join(" · ")}</p>}

      <div className="mt-2 space-y-2 rounded-md bg-zinc-50 p-2.5 text-sm text-zinc-900">
        {piece.metricCode === "none" ? (
          <p>ไม่วัดผล (evergreen)</p>
        ) : piece.hypothesis ? (
          <>
            <p className="font-semibold break-words whitespace-pre-wrap">สมมติฐาน: {piece.hypothesis}</p>
            {base && <p className="tabular-nums text-zinc-800">{[metric, base].filter(Boolean).join(" · ")}</p>}
          </>
        ) : (
          <p className="text-zinc-700">ยังไม่มีสมมติฐาน{metric ? ` · ตัวชี้วัด ${metric}` : ""}</p>
        )}
        {piece.thresholdTooNarrow && (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            เกณฑ์ผ่านห่างจากค่าฐานน้อยกว่าช่วงแกว่ง — แยกผลจากความบังเอิญไม่ได้
          </p>
        )}
        {piece.metricCode === "peak_viewers" && (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            คลิปเดียวพิสูจน์ยอดไลฟ์ทั้งคืนไม่ได้
          </p>
        )}
      </div>

      <dl className="mt-2 space-y-1 text-sm">
        {isClip && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-zinc-600">hook ตั้งต้น:</dt>
            <dd className="text-zinc-900">
              {hookTypes.length >= 2 ? hookTypes.map((t) => HOOK_TYPE_LABEL[t as keyof typeof HOOK_TYPE_LABEL] ?? t).join(" · ") : "ยังไม่มี hook ตั้งต้น 2 ประเภท"}
            </dd>
          </div>
        )}
        {signal && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-zinc-600">ที่มา:</dt>
            <dd className="min-w-0 break-words text-zinc-900">
              {signalKindLabel(signal.kind)}
              {signal.summary ? ` — ${signal.summary.length > 120 ? `${signal.summary.slice(0, 120)}…` : signal.summary}` : ""}
              {signal.seenOn ? ` (${formatThaiDay(signal.seenOn)})` : ""}
            </dd>
          </div>
        )}
        {(piece.footageStatus || piece.shootNote) && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-zinc-600">ต้องถ่ายอะไร:</dt>
            <dd className="min-w-0 break-words text-zinc-900">
              {[lbl(FOOTAGE_STATUS_LABEL, piece.footageStatus), piece.shootNote].filter(Boolean).join(" · ")}
            </dd>
          </div>
        )}
      </dl>

      {error && (
        <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-900">
          {blockers ? (
            <>
              <p className="font-semibold">วางแผนไม่ได้ — ยังขาด:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-red-800">วันที่เลือกบันทึกไว้แล้ว — เติมสิ่งที่ขาดด้วย “แก้แผน” แล้วระบบจะวางแผนต่อให้</p>
            </>
          ) : (
            <p className="font-medium">{error}</p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 sm:w-64">
          <label htmlFor={`day-${piece.stepId}`} className="mb-1 block text-sm font-medium text-zinc-800">
            ลงวัน
          </label>
          <select id={`day-${piece.stepId}`} className={SELECT} value={day} onChange={(e) => setDay(e.target.value)} disabled={busy}>
            <option value="">เลือกวันที่จะลง…</option>
            {shared.weekDays.map((d) => (
              <option key={d} value={d}>
                {dayOptionLabel(d, shared.dayCounts[d] ?? 0)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          <Button type="button" onClick={onChoose} loading={busy} disabled={!day || busy} aria-describedby={!day ? `hint-${piece.stepId}` : undefined}>
            <Check className="h-4 w-4" aria-hidden="true" />
            ทำ
          </Button>
          <Button type="button" variant="secondary" onClick={() => setSkipOpen(true)} disabled={busy}>
            <X className="h-4 w-4" aria-hidden="true" />
            ไม่ทำ
          </Button>
          <Button type="button" variant="secondary" onClick={() => setHoldOpen(true)} disabled={busy}>
            <Redo2 className="h-4 w-4" aria-hidden="true" />
            เลื่อน
          </Button>
        </div>
        {blockers && (
          <Button type="button" variant="secondary" onClick={() => setPlanOpen(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            แก้แผน
          </Button>
        )}
      </div>
      {!day && (
        <p id={`hint-${piece.stepId}`} className="mt-1.5 text-xs text-zinc-700">
          เลือกวันก่อนจึงกด “ทำ” ได้ — ระบบไม่เลือกวันให้
        </p>
      )}

      <Modal open={lineConfirm} onClose={() => setLineConfirm(false)} title="เกินโควตา LINE ในรอบ 28 วัน — ทำต่อ?">
        <div className="space-y-3">
          <p className="text-sm text-zinc-800">
            ชิ้นนี้เป็นข้อความ LINE{q?.overQuotaPlanned ? " และแผนรวมเกินโควตาอยู่แล้ว" : " และโควตารอบนี้เหลือ 0"} — ลงต่อได้ ระบบไม่บล็อก แต่ควรรู้ก่อนยืนยัน
          </p>
          {q && (
            <p className="rounded-md bg-zinc-50 p-2.5 text-sm tabular-nums text-zinc-900">
              ส่งแล้ว {q.used28d}/{q.quota} · วางแผนอีก {q.planned28d} · เหลือ {q.remaining28d}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setLineConfirm(false)}>
              กลับไปก่อน
            </Button>
            <Button type="button" onClick={() => void doChoose()}>
              ทำต่อ
            </Button>
          </div>
        </div>
      </Modal>

      {skipOpen && (
        <TransitionDialog
          open
          variant="skipIdea"
          onClose={() => setSkipOpen(false)}
          onSubmit={async (reason) => {
            const res = await skipIdea(piece.stepId, reason);
            if (res.ok) focusListHeading();
            return res;
          }}
        />
      )}
      {holdOpen && (
        <TransitionDialog
          open
          variant="holdIdea"
          onClose={() => setHoldOpen(false)}
          onSubmit={async (reason) => {
            const res = await holdIdea(piece.stepId, reason);
            if (res.ok) focusListHeading();
            return res;
          }}
        />
      )}
      {planOpen && (
        <PlanForm open piece={piece} hosts={shared.hosts} contentTypes={shared.contentTypes} todayTh={shared.todayTh} advanceToPlanned onClose={() => setPlanOpen(false)} />
      )}
    </li>
  );
}

/** ใบที่ถูกพัก ("เลื่อนไว้") — กลับมาคัดได้ */
export function HeldIdeaRow({ piece, contentType }: { piece: PieceRow; contentType?: ContentTypeOption }) {
  const { run, busy, error } = useRunAction();
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">{contentType && <ContentTypeChip contentType={contentType} />}</div>
      <h3 className="mt-1 text-base font-semibold break-words text-zinc-900">
        <Link href={`/marketing/pieces/${piece.stepId}?from=triage`} className="block min-h-11 py-1.5 hover:underline">
          {piece.title}
        </Link>
      </h3>
      {piece.holdReason && <p className="mt-1 rounded-md bg-orange-50 p-2 text-sm text-orange-900">เลื่อนไว้เพราะ: {piece.holdReason}</p>}
      {error && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
          {error}
        </p>
      )}
      <div className="mt-3">
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          disabled={busy}
          onClick={async () => {
            const res = await run(() => resumeIdea(piece.stepId), { success: "กลับมาคัดแล้ว" });
            if (res.ok) focusListHeading();
          }}
        >
          กลับมาคัด
        </Button>
      </div>
    </li>
  );
}

/** ใบที่ ✓ แล้ว (planned ในสัปดาห์) — ยกเลิกการเลือกได้ (planned → idea ไม่ต้องมีเหตุผล) */
export function ChosenRow({ piece, contentType }: { piece: PieceRow; contentType?: ContentTypeOption }) {
  const { run, busy, error } = useRunAction();
  return (
    <li className="rounded-lg border border-green-200 bg-green-50/40 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {contentType && <ContentTypeChip contentType={contentType} />}
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-900">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ทำ · ลง {piece.resolvedStart ? formatThaiDay(piece.resolvedStart) : "—"}
        </span>
      </div>
      <p className="mt-1 text-sm font-medium break-words text-zinc-900">
        <Link href={`/marketing/pieces/${piece.stepId}?from=triage`} className="block min-h-11 py-1.5 hover:underline">
          {piece.title}
        </Link>
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-800">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2 min-h-11"
        loading={busy}
        disabled={busy}
        onClick={async () => {
          await run(() => unchooseIdea(piece.stepId), { success: "ยกเลิกการเลือกแล้ว — กลับไปรอคัด" });
        }}
      >
        ยกเลิกการเลือก
      </Button>
    </li>
  );
}
