"use client";

// TaskDateActions — "เลื่อนวัน / ลบงาน" on /marketing/calendar/[stepId] (M4,
// design phase-content-calendar-design.md R3/R8). Delete is intentionally
// NOT gated client-side on campaignType/triggerKind: R8 already rejects
// template-plan steps server-side (SQLSTATE 22023) and
// lib/actions/calendar.ts's deleteTask() already maps that to a Thai
// message — duplicating the guard here would just be two places that can
// drift. A confirm step is still shown because delete is destructive.

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { rescheduleTask, deleteTask } from "@/lib/actions/calendar";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function TaskDateActions({
  stepId,
  initialDate,
  initialStartTime,
  stepOrigin,
}: {
  stepId: string;
  initialDate: string | null;
  /** "HH:MM" or null — prefills the time field so reschedule defaults to
   * "keep the current time" rather than silently clearing it. */
  initialStartTime: string | null;
  /** 'template' steps are rejected server-side on delete (R8, SQLSTATE
   * 22023) — disable the button instead of letting the owner hit that error
   * for nothing. */
  stepOrigin: "template" | "manual";
}) {
  const router = useRouter();
  const toast = useToast();
  const [date, setDate] = useState(initialDate ?? "");
  const [startTime, setStartTime] = useState(initialStartTime ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rescheduling, startRescheduleTransition] = useTransition();
  const [deleting, startDeleteTransition] = useTransition();
  const canDelete = stepOrigin !== "template";

  function handleReschedule(e: FormEvent) {
    e.preventDefault();
    if (!date) return;
    startRescheduleTransition(async () => {
      const result = await rescheduleTask(stepId, date, { startTime: startTime || undefined });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("เลื่อนวันแล้ว");
      // date changed -> this step's agenda day changed too, so land back on
      // the calendar at the new date rather than refreshing this page (its
      // own resolvedStart in the URL/back-link would now be stale anyway).
      router.push(`/marketing/calendar?d=${date}`);
    });
  }

  function handleClearTime() {
    if (!date) return;
    startRescheduleTransition(async () => {
      const result = await rescheduleTask(stepId, date, { clearTime: true });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      setStartTime("");
      toast.push("ลบเวลาแล้ว");
      router.refresh();
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteTask(stepId);
      if (!result.ok) {
        toast.push(result.error, "error");
        setConfirmingDelete(false);
        return;
      }
      toast.push("ลบงานแล้ว");
      router.push("/marketing/calendar");
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold text-zinc-900">เลื่อนวัน / ลบงาน</h2>

      <form onSubmit={handleReschedule} className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="reschedule-date" className="mb-1 block text-xs font-medium text-zinc-600">
            วันที่ใหม่
          </label>
          <input
            id="reschedule-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="min-h-11 rounded-md border border-zinc-300 px-3 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="reschedule-time" className="mb-1 block text-xs font-medium text-zinc-600">
            เวลา (ไม่บังคับ)
          </label>
          <input
            id="reschedule-time"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="min-h-11 rounded-md border border-zinc-300 px-3 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
        <Button type="submit" variant="secondary" size="sm" loading={rescheduling}>
          เลื่อนวัน
        </Button>
        {initialStartTime && (
          <Button type="button" variant="ghost" size="sm" loading={rescheduling} onClick={handleClearTime}>
            ลบเวลา
          </Button>
        )}
      </form>

      {confirmingDelete ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2.5">
          <p className="text-xs text-red-700">ยืนยันลบงานนี้? ลบได้เฉพาะงานที่เพิ่มเอง (ไม่ใช่งานจากแผนสำเร็จรูป)</p>
          <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
            ยืนยันลบ
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
            ยกเลิก
          </Button>
        </div>
      ) : canDelete ? (
        <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>
          ลบงาน
        </Button>
      ) : (
        <p className="text-xs text-zinc-400">งานจากแผนสำเร็จรูปลบไม่ได้ — ลบได้เฉพาะงานที่เพิ่มเอง</p>
      )}
    </section>
  );
}
