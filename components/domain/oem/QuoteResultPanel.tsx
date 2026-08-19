"use client";

// QuoteResultPanel — the right-hand (sticky on desktop) result column of
// /oem/quote (T5): loading/error/empty states around the live preview, plus
// the two save actions. Number display itself is OemCalcBreakdown (shared
// with the saved-quote detail view so the two never drift).

import { Loader2 } from "lucide-react";
import type { OemMetal, OemPriceCalcResult } from "@/lib/oem/types";
import { Button } from "@/components/ui/Button";
import { OemCalcBreakdown } from "./OemCalcBreakdown";

export function QuoteResultPanel({
  calc,
  calcLoading,
  calcError,
  metal,
  approvalNote,
  onApprovalNoteChange,
  onSaveDraft,
  onIssueQuote,
  savingDraft,
  savingQuote,
  canBuildInput,
  saveError,
}: {
  calc: OemPriceCalcResult | null;
  calcLoading: boolean;
  calcError: string | null;
  metal: OemMetal;
  approvalNote: string;
  onApprovalNoteChange: (v: string) => void;
  onSaveDraft: () => void;
  onIssueQuote: () => void;
  savingDraft: boolean;
  savingQuote: boolean;
  canBuildInput: boolean;
  saveError: string | null;
}) {
  const floors = calc?.floors ?? null;
  const marginState = floors?.margin.state ?? null;
  const hardBlocked = marginState === "hard_floor_breach";
  const needsNote = marginState === "needs_approval_note";
  const floorsPass =
    !!floors && floors.qty.pass === true && floors.jobValue.pass === true && (!floors.metalWeight.applies || floors.metalWeight.pass === true);

  const canIssue = !!calc && calc.isComplete && floorsPass && !hardBlocked && (!needsNote || approvalNote.trim().length > 0);

  return (
    <div className="space-y-3">
      {!calc && !calcLoading && !calcError && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
          กรอกวัสดุ / ประเภทงาน / น้ำหนัก / จำนวน ทางซ้ายเพื่อดูราคา
        </div>
      )}

      {calcLoading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          กำลังคำนวณ...
        </div>
      )}

      {calcError && !calcLoading && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
          {calcError}
        </div>
      )}

      {calc && !calcLoading && (
        <OemCalcBreakdown
          calc={calc}
          metal={metal}
          approvalNoteSlot={
            <div className="mt-2">
              <label htmlFor="oem-approval-note" className="text-xs font-semibold text-amber-800">
                margin ต่ำกว่า floor — ระบุเหตุผลก่อนออกใบเสนอราคา (บังคับ)
              </label>
              <textarea
                id="oem-approval-note"
                value={approvalNote}
                onChange={(e) => onApprovalNoteChange(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-amber-300 p-2 text-sm text-zinc-900"
                placeholder="เช่น ลูกค้าประจำ สั่งซ้ำแน่นอน"
              />
            </div>
          }
        />
      )}

      {saveError && (
        <p role="alert" className="text-xs text-red-600">
          {saveError}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" loading={savingDraft} disabled={!canBuildInput} onClick={onSaveDraft}>
          บันทึกร่าง
        </Button>
        <Button type="button" variant="primary" className="flex-1" loading={savingQuote} disabled={!canIssue} onClick={onIssueQuote}>
          ออกใบเสนอราคา
        </Button>
      </div>
    </div>
  );
}
