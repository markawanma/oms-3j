"use client";

// SignalStatusDialog — "ไม่ใช้" (เหตุผล ≥3) · "เก็บไว้ก่อน" (วันกลับมาดู ≥ วันนี้) · ถ้า DB บอกว่าสัญญาณถูกหยิบเป็นชิ้นงานแล้ว → ขอยืนยันซ้ำ (force)
// ตั้งสถานะใหม่ไม่ลบ/ยกเลิกชิ้นงานที่ผูกอยู่ — ข้อความบอกตรงๆ ก่อนยืนยัน · DB ตัดสินทุกด่าน

import { useId, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { GENERIC_ACTION_ERROR } from "@/components/domain/marketing/workflow/useRunAction";
import { setSignalStatus } from "@/lib/actions/content-signals";
import type { SignalRow } from "@/lib/marketing/signal-types";

const FIELD =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

export function SignalStatusDialog({ signal, mode, todayTh, onClose }: { signal: SignalRow; mode: "rejected" | "deferred"; todayTh: string; onClose: () => void }) {
  const uid = useId();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reviewOn, setReviewOn] = useState("");
  const [force, setForce] = useState<{ stepId: string | null; message: string } | null>(null);
  const rejected = mode === "rejected";
  const ready = rejected ? reason.trim().length >= 3 : reviewOn !== "";

  async function submit(forced: boolean) {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await setSignalStatus(signal.id, { status: mode, reason, reviewOn, force: forced });
      if (res.ok) {
        toast.push(rejected ? "ตั้งเป็น “ไม่ใช้” แล้ว" : "เก็บไว้ก่อนแล้ว");
        onClose();
        router.refresh();
        return;
      }
      if (res.needsForce) {
        setForce({ stepId: res.pickedStepId ?? null, message: res.error });
        return;
      }
      setError(res.error);
      if (res.stale) router.refresh();
    } catch {
      setError(GENERIC_ACTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={rejected ? "ไม่ใช้สัญญาณนี้" : "เก็บไว้ก่อน"}>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        {force ? (
          <div role="alert" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">{force.message}</p>
            {force.stepId && (
              <Link href={`/marketing/pieces/${force.stepId}`} className="inline-flex min-h-11 items-center font-medium underline">
                ดูชิ้นงานที่ได้รับผลกระทบ
              </Link>
            )}
          </div>
        ) : rejected ? (
          <div>
            <label htmlFor={`${uid}-r`} className="mb-1 block text-sm font-medium text-zinc-800">
              เหตุผลที่ไม่ใช้ (อย่างน้อย 3 ตัวอักษร)
            </label>
            <textarea id={`${uid}-r`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className={`${FIELD} py-2`} />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor={`${uid}-d`} className="mb-1 block text-sm font-medium text-zinc-800">
                กลับมาดูวันที่
              </label>
              <input id={`${uid}-d`} type="date" min={todayTh} value={reviewOn} onChange={(e) => setReviewOn(e.target.value)} className={FIELD} />
            </div>
            <div>
              <label htmlFor={`${uid}-n`} className="mb-1 block text-sm font-medium text-zinc-800">
                เหตุผล (ไม่บังคับ)
              </label>
              <input id={`${uid}-n`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={FIELD} />
            </div>
          </>
        )}
        {error && !force && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          {force ? (
            <Button type="button" variant={rejected ? "danger" : "primary"} loading={busy} disabled={busy} onClick={() => void submit(true)}>
              ยืนยันตั้งสถานะ
            </Button>
          ) : (
            <Button type="submit" variant={rejected ? "danger" : "primary"} loading={busy} disabled={!ready || busy}>
              {rejected ? "ไม่ใช้" : "เก็บไว้ก่อน"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
