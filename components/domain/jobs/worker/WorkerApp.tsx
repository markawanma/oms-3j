"use client";

// WorkerApp — หน้าช่าง /w/<token> (สาธารณะ · มือถือเป็นหลัก)
// เลขงาน + แบบ + จำนวน + โลหะ + ผู้ถือ → ปุ่มหลักตาม next_action (รับงาน / ส่งต่อ) อยู่ในจอแรก 390x844 · แถบขั้น (ปัจจุบัน ±1) อยู่ใต้ปุ่ม · ไม่มีเมนูแอป/ลิงก์ไปหน้าอื่นเลย
// 🔴 ข้อมูลที่ได้มาผ่าน sanitizeWorkerView แล้ว (ไม่มีราคา/ต้นทุน/ชื่อลูกค้า) — component นี้ไม่เรียก DB เอง
// ก่อน hydrate เสร็จ: แสดง skeleton แทนปุ่ม (ปุ่มที่กดตอนนั้นจะไม่ติด) · ผลสำเร็จ = เครื่องหมายถูกเขียว · แพ้การแย่งรับขั้น = ไอคอนเหลือง + ชื่อผู้ชนะ

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { IdentifyPanel, ReceivePanel, SendPanel } from "@/components/domain/jobs/worker/WorkerPanels";
import type { DoneTone } from "@/components/domain/jobs/worker/WorkerPanels";
import { BigButton, PanelSkeleton, StageStrip, useHydrated } from "@/components/domain/jobs/worker/WorkerParts";
import { workerLogout } from "@/lib/actions/job-worker";
import { WORKER_CODE_TH, prevNotSentMessage } from "@/lib/jobs/messages";
import { METAL_LABEL } from "@/lib/jobs/types";
import { prevStageName } from "@/lib/jobs/worker-view";
import type { NextAction, WorkerView } from "@/lib/jobs/worker-view";

const INFO: Partial<Record<NextAction, { tone: "amber" | "zinc"; text: string }>> = {
  awaiting_deposit: { tone: "amber", text: "รอมัดจำ — ยังเริ่มผลิตไม่ได้ ถามออฟฟิศ" },
  not_your_stage: { tone: "zinc", text: "ขั้นถัดไปไม่ใช่ขั้นของคุณ" },
  on_hold: { tone: "amber", text: "ใบงานนี้ถูกพักไว้ — รอออฟฟิศ" },
  all_done: { tone: "zinc", text: WORKER_CODE_TH.all_done },
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return `${day}/${m}/${y + 543}`;
}

export function WorkerApp({ token, view }: { token: string; view: WorkerView }) {
  const router = useRouter();
  const ready = useHydrated();
  const [done, setDone] = useState<{ msg: string; tone: DoneTone } | null>(null);
  const [outBusy, setOutBusy] = useState(false);
  const j = view.job;

  // หลังสำเร็จ: เครื่องหมายถูกเต็มจอ ~2 วิ (เตือนแพ้การแย่ง ~4 วิ + ปุ่มตกลง) แล้วโหลดสถานะใหม่ (ไม่ทิ้งหน้าให้กดซ้ำ)
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      setDone(null);
      router.refresh();
    }, done.tone === "warn" ? 4000 : 2000);
    return () => clearTimeout(t);
  }, [done, router]);

  if (done) {
    const warn = done.tone === "warn";
    return (
      <div role="status" aria-live="polite" className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
        {warn ? <AlertTriangle data-testid="done-warn" className="h-28 w-28 text-amber-600" aria-hidden="true" /> : <CheckCircle2 data-testid="done-ok" className="h-28 w-28 text-green-700" aria-hidden="true" />}
        <p className="text-3xl font-bold text-zinc-900">{done.msg}</p>
        <p className="text-lg text-zinc-700">{j.jobNo}</p>
        {warn && (
          <BigButton type="button" onClick={() => { setDone(null); router.refresh(); }}>
            ตกลง
          </BigButton>
        )}
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

  const info = view.nextAction === "prev_not_sent" ? { tone: "amber" as const, text: prevNotSentMessage(prevStageName(view)) } : INFO[view.nextAction];

  return (
    <div className="space-y-4">
      <header className="space-y-0.5">
        <p className="text-base font-semibold text-zinc-700">ใบงาน</p>
        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900">{j.jobNo}</h1>
        {j.designLabel !== undefined && <p className="text-xl font-semibold break-words text-zinc-900">{j.designLabel}</p>}
        {j.designLabel !== undefined && (
          <p className="text-lg text-zinc-800">
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

      {view.heldBy && view.heldBy !== view.viewer?.displayName && <p className="rounded-xl bg-zinc-100 p-3 text-lg text-zinc-900">ตอนนี้อยู่กับ <strong>{view.heldBy}</strong></p>}

      {!ready ? (
        <PanelSkeleton />
      ) : (
        <>
          {view.nextAction === "identify" && <IdentifyPanel token={token} workers={view.workers} onDone={() => router.refresh()} />}
          {view.nextAction === "receive" && view.actionStage && <ReceivePanel token={token} view={view} onDone={(msg, tone = "ok") => setDone({ msg, tone })} />}
          {view.nextAction === "send" && view.actionStage && <SendPanel token={token} view={view} onDone={(msg, tone = "ok") => setDone({ msg, tone })} />}
          {view.nextAction === "held_by_other" && (
            <p className="rounded-xl bg-zinc-100 p-4 text-xl text-zinc-900">ขั้น {view.actionStage?.name ?? "นี้"} ยังอยู่กับ {view.heldBy ?? "คนอื่น"} — รอเขาส่งต่อก่อน</p>
          )}
          {info && <p className={`rounded-xl p-4 text-xl font-semibold ${info.tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-zinc-100 text-zinc-900"}`}>{info.text}</p>}
        </>
      )}

      <StageStrip stages={j.stages} currentSeq={current} />

      {view.viewer && (
        <footer className="border-t border-zinc-200 pt-3">
          <p className="mb-2 text-lg text-zinc-800">
            คุณคือ <strong>{view.viewer.displayName}</strong>
          </p>
          <BigButton type="button" tone="secondary" onClick={() => void logout()} loading={outBusy} disabled={!ready}>
            ไม่ใช่คุณ? เปลี่ยนคน
          </BigButton>
        </footer>
      )}
    </div>
  );
}
