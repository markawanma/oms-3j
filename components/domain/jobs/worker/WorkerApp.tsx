"use client";

// WorkerApp — หน้าช่าง /w/<token> (สาธารณะ · มือถือเป็นหลัก)
// เลขงาน + แบบ + จำนวน + โลหะ + ผู้ถือ → ปุ่มหลักตาม next_action (รับงาน / ส่งต่อ) อยู่ในจอแรก 390x844 · แถบขั้น (ปัจจุบัน ±1) อยู่ใต้ปุ่ม · ไม่มีเมนูแอป/ลิงก์ไปหน้าอื่นเลย
// 🔴 ข้อมูลที่ได้มาผ่าน sanitizeWorkerView แล้ว (ไม่มีราคา/ต้นทุน/ชื่อลูกค้า) — component นี้ไม่เรียก DB เอง
// ก่อน hydrate เสร็จ: แสดง skeleton แทนปุ่ม (ปุ่มที่กดตอนนั้นจะไม่ติด) · ผลสำเร็จ = เครื่องหมายถูกเขียว · แพ้การแย่งรับขั้น = ไอคอนเหลือง + ชื่อผู้ชนะ

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { IdentifyPanel, ReceivePanel, SendPanel } from "@/components/domain/jobs/worker/WorkerPanels";
import type { DoneTone, SplitResultInfo } from "@/components/domain/jobs/worker/WorkerPanels";
import { MultiPanel, SplitDone } from "@/components/domain/jobs/worker/WorkerLots";
import { BigButton, PanelSkeleton, StageStrip, useHydrated } from "@/components/domain/jobs/worker/WorkerParts";
import { JobPhotoThumb } from "@/components/domain/jobs/photos/JobPhotoThumb";
import { JobPhotoViewer } from "@/components/domain/jobs/photos/JobPhotoViewer";
import { useRefreshGate } from "@/components/domain/jobs/photos/useRefreshGate";
import type { RetryReason } from "@/components/domain/jobs/photos/types";
import { workerLogout } from "@/lib/actions/job-worker";
import { WORKER_CODE_TH, prevNotSentMessage } from "@/lib/jobs/messages";
import { METAL_LABEL } from "@/lib/jobs/types";
import { isMultiView, prevStageName } from "@/lib/jobs/worker-view";
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
  // 0181: แยกส่วนสำเร็จ → จอ "แบ่งส่วนแล้ว" (QR ใบเดิมบนจอ + ยกเลิกการแยก) — ไม่ปิดเอง
  const [split, setSplit] = useState<SplitResultInfo | null>(null);
  // N5: หลัง refresh ข้อมูลใหม่ยังไม่มา แผงเก่าห้ามกดได้ — โชว์ skeleton จนกว่า view ใหม่จะมาถึง (หรือครบ 8 วิ กันค้าง)
  const [waiting, setWaiting] = useState(false);
  const j = view.job;
  // 0182: รูปอ้างอิง (มีเฉพาะช่างที่ระบุตัวแล้ว · รูปหลักก่อน) — 0189 W2: รูปหลักใหญ่บนหัวจอ (เดิมภาพย่อ 80px) · แตะ = เต็มจอ ปัดดู · ไม่มีรูป = ไม่ render อะไรเลย (จอเดิมเป๊ะ)
  const photos = j.photos ?? [];
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  // กันขอลิงก์ใหม่อัตโนมัติวนไม่จบ: อัตโนมัติ ≤ 2 ครั้ง (ห่าง ≥ 10 วินาที) จนช่างแตะ "ลองใหม่" แล้วรีเซ็ต (useRefreshGate)
  const allowPhotoRefresh = useRefreshGate();
  // signed URL หมดอายุ 15 นาที แต่เซสชันช่างอยู่ได้ 12 ชม. → รูปโหลดล้ม = ขอ view ใหม่ (ลิงก์ใหม่) · อัตโนมัติจำกัดด้วย useRefreshGate · แตะลองใหม่ได้เสมอ
  // ใช้ router.refresh() ตรงๆ ไม่ใช่ refreshView: refreshView สลับแผงเป็น skeleton (ค่าที่ช่างกรอกค้างอยู่หาย) — รูปไม่ควรกระทบแผนรับ/ส่ง
  const onPhotoRetry = useCallback(
    (reason: RetryReason) => {
      if (!allowPhotoRefresh(reason)) return;
      router.refresh();
    },
    [router, allowPhotoRefresh],
  );

  useEffect(() => {
    setWaiting(false);
  }, [view]);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setWaiting(false), 8000);
    return () => clearTimeout(t);
  }, [waiting]);
  const refreshView = useCallback(() => {
    setWaiting(true);
    router.refresh();
  }, [router]);

  // หลังสำเร็จ: เครื่องหมายถูกเต็มจอ ~2 วิ (เตือนแพ้การแย่ง ~4 วิ + ปุ่มตกลง) แล้วโหลดสถานะใหม่ (ไม่ทิ้งหน้าให้กดซ้ำ)
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      setDone(null);
      refreshView();
    }, done.tone === "warn" ? 4000 : 2000);
    return () => clearTimeout(t);
  }, [done, refreshView]);

  if (split) {
    return (
      <SplitDone
        token={token}
        view={view}
        info={split}
        onFinish={() => { setSplit(null); refreshView(); }}
        onCancelled={(msg) => { setSplit(null); setDone({ msg, tone: "ok" }); }}
      />
    );
  }

  if (done) {
    const warn = done.tone === "warn";
    return (
      <div role="status" aria-live="polite" className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
        {warn ? <AlertTriangle data-testid="done-warn" className="h-28 w-28 text-amber-600" aria-hidden="true" /> : <CheckCircle2 data-testid="done-ok" className="h-28 w-28 text-green-700" aria-hidden="true" />}
        <p className="text-3xl font-bold text-zinc-900">{done.msg}</p>
        <p className="text-lg text-zinc-700">{j.jobNo}</p>
        {warn && (
          <BigButton type="button" onClick={() => { setDone(null); refreshView(); }}>
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
      refreshView();
    }
  }

  // 0181: ใบเดี่ยว — my_actions ของขั้นที่ action_stage ชี้ (ใช้เปิดช่อง "ส่งไม่ครบ?/ได้ไม่ครบ?") · ไม่มี = หน้าเดิมทุกประการ
  const soloAction = (kind: "send" | "receive") => view.myActions?.find((a) => a.action === kind && a.stageSeq === view.actionStage?.seq);
  const info = view.nextAction === "prev_not_sent" ? { tone: "amber" as const, text: prevNotSentMessage(prevStageName(view)) } : INFO[view.nextAction];

  const titleBlock = (
    <>
      <p className="text-base font-semibold text-zinc-700">ใบงาน</p>
      <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900">{j.jobNo}</h1>
    </>
  );

  return (
    <div className="space-y-4">
      <header className="space-y-0.5">
        {photos.length > 0 && (
          // 0189 W2 (มติ 21 ต.ค. "ช่างตรวจว่าถูกชิ้นจากรูป"): รูปหลักใหญ่เกือบเต็มความกว้างบนหัวจอ (เดิมภาพย่อ 80px) · แตะ = เต็มจอ ปัดดูทุกรูป
          // 🔴 สูงจำกัด min(30vh, 13rem) + object-contain (ไม่ตัดชิ้นงาน) — กันดันปุ่มหลัก sticky (รับงาน/ส่งต่อ) ตกจอที่ 360×640 · ใช้ภาพกลาง (md) ให้ชัดบนจอ 3x · ไม่มีรูป = จอเดิมเป๊ะ
          <div className="pb-2">
            <JobPhotoThumb
              smUrl={photos[0].mdUrl ?? photos[0].smUrl}
              size="hero"
              label={`รูปงาน ${j.jobNo} ${photos.length > 1 ? `${photos.length} รูป ` : ""}แตะเพื่อดูเต็มจอ`}
              countChip={photos.length}
              onClick={() => setViewerAt(0)}
              onRetryLoad={onPhotoRetry}
            />
          </div>
        )}
        {titleBlock}
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

      {!isMultiView(view) && view.nextAction !== "held_by_other" && view.heldBy && view.heldBy !== view.viewer?.displayName && <p className="rounded-xl bg-zinc-100 p-3 text-lg text-zinc-900">ตอนนี้อยู่กับ <strong>{view.heldBy}</strong></p>}

      {!ready || waiting ? (
        <PanelSkeleton />
      ) : (
        <>
          {view.nextAction === "identify" && <IdentifyPanel token={token} workers={view.workers} onDone={refreshView} />}
          {view.nextAction === "receive" && view.actionStage && <ReceivePanel token={token} view={view} action={soloAction("receive")} onDone={(msg, tone = "ok") => setDone({ msg, tone })} onReload={refreshView} />}
          {view.nextAction === "send" && view.actionStage && <SendPanel token={token} view={view} action={soloAction("send")} onSplit={setSplit} onDone={(msg, tone = "ok") => setDone({ msg, tone })} onReload={refreshView} />}
          {isMultiView(view) && <MultiPanel token={token} view={view} onDone={(msg, tone = "ok") => setDone({ msg, tone })} onReload={refreshView} onSplit={setSplit} onCancelled={(msg) => setDone({ msg, tone: "ok" })} />}
          {view.nextAction === "held_by_other" && (
            <p className="rounded-xl bg-zinc-100 p-4 text-xl text-zinc-900">ขั้น {view.actionStage?.name ?? "นี้"} ยังอยู่กับ {view.heldBy ?? "คนอื่น"} — รอเขาส่งต่อก่อน</p>
          )}
          {info && <p className={`rounded-xl p-4 text-xl font-semibold ${info.tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-zinc-100 text-zinc-900"}`}>{info.text}</p>}
        </>
      )}

      <StageStrip stages={j.stages} currentSeq={current} />

      {viewerAt !== null && photos.length > 0 && (
        <JobPhotoViewer
          photos={photos.map((p) => ({ id: p.id, smUrl: p.smUrl, mdUrl: p.mdUrl, isPrimary: p.isPrimary }))}
          index={viewerAt}
          onIndexChange={setViewerAt}
          onClose={() => setViewerAt(null)}
          title={j.jobNo}
          closeSize="worker"
          onRetryLoad={onPhotoRetry}
        />
      )}

      {view.viewer && (
        <footer className="border-t border-zinc-200 pt-3">
          <p className="mb-2 text-lg text-zinc-800">
            คุณคือ <strong>{view.viewer.displayName}</strong>
          </p>
          <BigButton type="button" tone="secondary" onClick={() => void logout()} loading={outBusy} disabled={!ready || waiting}>
            ไม่ใช่คุณ? เปลี่ยนคน
          </BigButton>
        </footer>
      )}
    </div>
  );
}
