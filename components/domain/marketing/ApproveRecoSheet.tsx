"use client";

// ApproveRecoSheet — M5 of the Content Calendar phase (docs/3j-jewelry/
// marketing/phase-content-calendar-design.md §6 "Mapping reco → task").
// Confirmation bottom-sheet shown instead of the plain "อนุมัติ" button when
// a reco's rule_code has a matching campaign_template: lets the owner pick a
// start date, then does create → decide IN THAT ORDER (never swapped — if
// campaign_create_from_template fails, mkt_reco_decision must stay untouched
// so the reco is still "pending" and can be retried; createTaskFromReco is
// idempotent on (shop_id, source_reco_key) so a retry after a partial
// failure never double-creates a plan).
//
// Bottom-sheet shell copied from AddPlanForm.tsx (same fixed-overlay +
// rounded-t-xl pattern) — no new dialog primitive introduced.

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, X } from "lucide-react";
import { createTaskFromReco } from "@/lib/actions/calendar";
import type { CampaignTemplateRow } from "@/lib/actions/calendar";
import { decideReco } from "@/lib/actions/marketing";
import type { MktRecoRow } from "@/lib/marketing/types";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function bangkokTodayISO(): string {
  return effectiveDateBangkok(new Date().toISOString());
}

/** Design §6 default-date rule: event_date templates prefill from the reco's
 * own `detail.date` (e.g. the promo day seasonal_calendar found); everything
 * else (start_date templates, or event_date with no usable payload date)
 * defaults to today in Bangkok. */
function computeDefaultDate(template: CampaignTemplateRow, reco: MktRecoRow): string {
  if (template.anchorSemantics === "event_date") {
    const raw = reco.detail?.date;
    if (typeof raw === "string" && DATE_ONLY_RE.test(raw)) return raw;
  }
  return bangkokTodayISO();
}

export function ApproveRecoSheet({
  reco,
  template,
  onClose,
  onApproved,
}: {
  reco: MktRecoRow;
  template: CampaignTemplateRow;
  /** Cancel / backdrop click / post-success "ปิด" — always safe to call,
   * never itself mutates reco state. */
  onClose: () => void;
  /** Fired only after BOTH the plan was created AND decideReco succeeded —
   * lets RecoList flip this row to "approved" locally (and remember the
   * anchor date for the "ดูแผนในปฏิทิน" link) without a full refetch. */
  onApproved: (recoKey: string, anchorDate: string) => void;
}) {
  const [date, setDate] = useState(() => computeDefaultDate(template, reco));
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<{ anchorDate: string } | null>(null);
  const toast = useToast();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!DATE_ONLY_RE.test(date)) {
      toast.push("กรุณาเลือกวันเริ่ม", "error");
      return;
    }
    startTransition(async () => {
      // 1) create the plan first.
      const createResult = await createTaskFromReco({
        templateCode: template.code,
        anchorDate: date,
        recoKey: reco.recoKey,
      });
      if (!createResult.ok) {
        toast.push(createResult.error, "error");
        return; // sheet stays open, reco stays pending — retry is safe (idempotent).
      }

      // 2) only now mark the reco decided. If this leg fails, the plan
      // already exists (idempotent create means retrying step 1 is free),
      // so we surface the error and let the owner press "สร้างแผน" again
      // rather than silently losing the pending state.
      const decideResult = await decideReco({ recoKey: reco.recoKey, status: "approved" });
      if (!decideResult.ok) {
        toast.push(`สร้างแผนสำเร็จแล้ว แต่บันทึกการอนุมัติไม่สำเร็จ: ${decideResult.error} — กด "สร้างแผน" อีกครั้งเพื่อลองใหม่`, "error");
        return;
      }

      toast.push("สร้างแผนแล้ว");
      onApproved(reco.recoKey, date);
      setDone({ anchorDate: date });
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="อนุมัติและสร้างแผน"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-t-xl bg-white p-4 shadow-lg sm:rounded-xl"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-zinc-900">{done ? "สร้างแผนแล้ว" : "อนุมัติ → สร้างแผน"}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-md bg-green-50 px-3 py-2.5 text-sm text-green-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                สร้างแผน &ldquo;{template.nameTh}&rdquo; แล้ว — เริ่ม {done.anchorDate}
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={onClose}>
                ปิด
              </Button>
              <Link
                href={`/marketing/calendar?tab=plan&d=${done.anchorDate}`}
                onClick={onClose}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
              >
                ดูในปฏิทิน
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-zinc-900">{reco.title}</p>
              <p className="mt-0.5 text-xs text-zinc-500">จะสร้างแผน: {template.nameTh}</p>
            </div>

            <div>
              <label htmlFor="approve-reco-date" className="mb-1 block text-xs font-medium text-zinc-600">
                วันเริ่ม
              </label>
              <div className="relative">
                <CalendarClock
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <input
                  id="approve-reco-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="min-h-11 w-full rounded-md border border-zinc-300 pr-3 pl-9 text-sm focus:border-primary-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
                ยกเลิก
              </Button>
              <Button type="submit" loading={pending}>
                สร้างแผน
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
