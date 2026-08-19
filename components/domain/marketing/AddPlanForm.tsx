"use client";

// AddPlanForm — "เพิ่มแผนเอง" (design ux-content-calendar.md §1B, R2
// campaign_create_task via lib/actions/calendar.ts's createManualTask).
// Self-contained widget: button + its own open/close state + the inline
// form itself, so it can be dropped in more than once on the same page (page
// header action + mobile FAB + empty-state action all use separate instances
// — each just opens its own sheet, no shared state to wire up). Not a modal
// library — a fixed bottom-sheet on mobile per the UX doc's native-input
// rule (date input must stay <input type="date">, no custom picker).

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createManualTask } from "@/lib/actions/calendar";
import { ARTIFACT_TYPE_LABEL } from "@/lib/marketing/campaign-types";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

// Subset of artifact_type the owner actually picks manually here (design's
// M3 scope note) — full enum lives in campaign-types.ts / clip-brief.ts for
// the template-driven and AI-drafted paths.
const ARTIFACT_TYPE_OPTIONS = ["short_form_clip", "broadcast_script_line", "fb_post", "live_rundown"] as const;

export function AddPlanForm({
  defaultDate,
  variant = "button",
}: {
  /** Prefill for the date field — the currently-viewed agenda date (design:
   * "default = วันที่กำลังดูอยู่"). */
  defaultDate: string;
  /** "button" = normal inline trigger (page header, empty-state action).
   * "fab" = fixed bottom-right circular button, mobile-only (md:hidden) —
   * stays reachable while the agenda list scrolls (UX doc mobile rule). */
  variant?: "button" | "fab";
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("");
  const [artifactType, setArtifactType] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function reset() {
    setTitle("");
    setDate(defaultDate);
    setStartTime("");
    setArtifactType("");
    setTitleError(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError("กรุณากรอกชื่องาน");
      return;
    }
    startTransition(async () => {
      const result = await createManualTask({
        title: trimmed,
        date,
        startTime: startTime || undefined,
        artifactType: artifactType || undefined,
      });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("เพิ่มแผนแล้ว");
      close();
      // Server component page owns the fetched month's tasks — refresh is
      // how the new step shows up in the agenda without duplicating
      // getCalendarTasks' filtering/sorting logic client-side here.
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="เพิ่มแผน"
        className={
          variant === "fab"
            ? "fixed right-4 bottom-4 z-40 flex min-h-14 min-w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-lg hover:bg-primary-700 md:hidden"
            : "inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
        }
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
        {variant === "button" && "เพิ่มแผน"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="เพิ่มแผนเอง"
          onClick={close}
        >
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-3 rounded-t-xl bg-white p-4 shadow-lg sm:rounded-xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-zinc-900">เพิ่มแผนเอง</p>
              <button
                type="button"
                onClick={close}
                aria-label="ปิด"
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div>
              <label htmlFor="plan-title" className="mb-1 block text-xs font-medium text-zinc-600">
                ชื่องาน
              </label>
              <input
                id="plan-title"
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleError(null);
                }}
                required
                className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm focus:border-primary-500 focus:outline-none"
              />
              {titleError && <p className="mt-1 text-xs text-red-600">{titleError}</p>}
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="plan-date" className="mb-1 block text-xs font-medium text-zinc-600">
                  วันที่
                </label>
                <input
                  id="plan-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="plan-start-time" className="mb-1 block text-xs font-medium text-zinc-600">
                  เวลา (ไม่บังคับ)
                </label>
                <input
                  id="plan-start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm focus:border-primary-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="plan-artifact-type" className="mb-1 block text-xs font-medium text-zinc-600">
                ประเภท content (ไม่บังคับ)
              </label>
              <select
                id="plan-artifact-type"
                value={artifactType}
                onChange={(e) => setArtifactType(e.target.value)}
                className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm focus:border-primary-500 focus:outline-none"
              >
                <option value="">ไม่ระบุ</option>
                {ARTIFACT_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {ARTIFACT_TYPE_LABEL[t] ?? t}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={close}>
                ยกเลิก
              </Button>
              <Button type="submit" loading={pending}>
                บันทึก
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
