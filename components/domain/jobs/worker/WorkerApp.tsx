"use client";

// WorkerApp — หน้าช่าง /w/<token> (สาธารณะ · มือถือเป็นหลัก)
// เลขงาน + แบบ + จำนวน + โลหะ + ขั้นปัจจุบัน + ผู้ถือ → ปุ่มเดียวตาม next_action (รับงาน / ส่งต่อ) · ไม่มีเมนูแอป/ลิงก์ไปหน้าอื่นเลย
// 🔴 ข้อมูลที่ได้มาผ่าน sanitizeWorkerView แล้ว (ไม่มีราคา/ต้นทุน/ชื่อลูกค้า) — component นี้ไม่เรียก DB เอง

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { IdentifyPanel, ReceivePanel, SendPanel } from "@/components/domain/jobs/worker/WorkerPanels";
import { BigButton, StageStrip } from "@/components/domain/jobs/worker/WorkerParts";
import { workerLogout } from "@/lib/actions/job-worker";
import { METAL_LABEL } from "@/lib/jobs/types";
import type { NextAction, WorkerView } from "@/lib/jobs/worker-view";

const INFO: Partial<Record<NextAction, { tone: "amber" | "zinc"; text: string }>> = {
  awaiting_deposit: { tone: "amber", text: "รอมัดจำ — ยังเริ่มผลิตไม่ได้ ถามออฟฟิศ" },
  not_your_stage: { tone: "zinc", text: "ขั้นถัดไปไม่ใช่ขั้นของคุณ" },
  prev_not_sent: { tone: "amber", text: "ขั้นก่อนหน้ายังไม่ส่งต่อ — ให้คนถืออยู่กดส่งต่อก่อน" },
  on_hold: { tone: "amber", text: "ใบงานนี้ถูกพักไว้ — รอออฟฟิศ" },
  none: { tone: "zinc", text: "ไม่มีขั้นที่ต้องทำในตอนนี้" },
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return `${day}/${m}/${y + 543}`;
}

export function WorkerApp({ token, view }: { token: string; view: WorkerView }) {
  const router = useRouter();
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [outBusy, setOutBusy] = useState(false);
  const j = view.job;

  // หลังสำเร็จ: เครื่องหมายถูกเต็มจอ ~2 วิ แล้วโหลดสถานะใหม่ (ไม่ทิ้งหน้าให้กดซ้ำ)
  useEffect(() => {
    if (!doneMsg) return;
    const t = setTimeout(() => {
      setDoneMsg(null);
      router.refresh();
    }, 2000);
    return () => clearTimeout(t);
  }, [doneMsg, router]);

  if (doneMsg) {
    return (
      <div role="status" aria-live="polite" className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
        <CheckCircle2 className="h-28 w-28 text-green-700" aria-hidden="true" />
        <p className="text-3xl font-bold text-zinc-900">{doneMsg}</p>
        <p className="text-lg text-zinc-700">{j.jobNo}</p>
      </div>
    );
  }

  const current = view.actionStage?.seq ?? j.stages.find((s) => s.status === "received")?.seq ?? j.stages.find((s) => s.status === "pending")?.seq ?? null;

  async function logout() {
    setOutBusy(true);
    try {
      await workerLogout();
    } finally {
      setOutBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-lg font-semibold text-zinc-700">ใบงาน</p>
        <h1 className="text-5xl font-extrabold tracking-tight text-zinc-900">{j.jobNo}</h1>
        {j.designLabel !== undefined && (
          <p className="text-2xl font-semibold break-words text-zinc-900">{j.designLabel}</p>
        )}
        {j.designLabel !== undefined && (
          <p className="text-xl text-zinc-800">
            {[j.qtyPlanned !== undefined ? `${j.qtyPlanned} ชิ้น` : null, j.metal ? (METAL_LABEL[j.metal] ?? j.metal) : null, j.sku ?? null].filter(Boolean).join(" · ")}
            {j.dueDate ? ` · ส่ง ${fmtDate(j.dueDate)}` : ""}
          </p>
        )}
      </header>

      {view.sessionExpired && (
        <p role="alert" className="rounded-xl bg-amber-50 p-3 text-lg font-semibold text-amber-900">
          หมดเวลาแล้ว — ใส่ PIN ใหม่
        </p>
      )}

      {view.heldBy && <p className="rounded-xl bg-zinc-100 p-3 text-xl text-zinc-900">ตอนนี้อยู่กับ <strong>{view.heldBy}</strong></p>}

      <StageStrip stages={j.stages} currentSeq={current} />

      {view.nextAction === "identify" && <IdentifyPanel token={token} workers={view.workers} onDone={() => router.refresh()} />}
      {view.nextAction === "receive" && view.actionStage && <ReceivePanel token={token} view={view} onDone={setDoneMsg} />}
      {view.nextAction === "send" && view.actionStage && <SendPanel token={token} view={view} onDone={setDoneMsg} />}
      {view.nextAction === "held_by_other" && (
        <p className="rounded-xl bg-zinc-100 p-4 text-xl text-zinc-900">ขั้น {view.actionStage?.name ?? "นี้"} ยังอยู่กับ {view.heldBy ?? "คนอื่น"} — รอเขาส่งต่อก่อน</p>
      )}
      {INFO[view.nextAction] && (
        <p className={`rounded-xl p-4 text-xl font-semibold ${INFO[view.nextAction]!.tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-zinc-100 text-zinc-900"}`}>{INFO[view.nextAction]!.text}</p>
      )}

      {view.viewer && (
        <footer className="border-t border-zinc-200 pt-4">
          <p className="mb-2 text-lg text-zinc-800">
            คุณคือ <strong>{view.viewer.displayName}</strong>
          </p>
          <BigButton type="button" tone="secondary" onClick={() => void logout()} loading={outBusy}>
            ไม่ใช่คุณ? เปลี่ยนคน
          </BigButton>
        </footer>
      )}
    </div>
  );
}
