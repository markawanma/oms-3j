"use client";

// ShopIntakeApp — หน้า /w/s/<shopToken> ทั้งหน้า (หน้าเดียวเดิน step ใน client · ไม่มีลิงก์ออกนอกแอปช่าง)
// hub (W-1 + W-9 "ใบที่ฉันเปิด") ↔ วิซาร์ดเปิดใบ (ShopOpenFlow) ↔ จอแก้รูปของใบ (ShopJobPhotosScreen · W-10)
// วิซาร์ด/จอแก้รูปคง mount ไว้ (แค่ซ่อน) เมื่อ session หมดเวลา/hub เปลี่ยนสภาพ — ข้อมูลที่กรอก/รูป/QR ไม่หาย
// จอแก้รูปเป็นของคนที่เปิดจอ: คนอื่น login แทน (workerId เปลี่ยน) = ปิดจอ (กันใบของคนเดิมโผล่ให้คนใหม่)
// ก่อน hydrate เสร็จ = skeleton (ปุ่มที่กดก่อน hydrate จะไม่ติด · ไม่โชว์รายชื่อช่างก่อนรู้สถานะ token — กันรั่ว)
// 🔴 ข้อมูลที่ได้มาผ่าน allowlist ที่ worker-server แล้ว (ไม่มีราคา/ต้นทุน) — component นี้ไม่เรียก DB เอง · เรียกได้เฉพาะ action ใน lib/actions/job-worker.ts

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PanelSkeleton, useHydrated } from "@/components/domain/jobs/worker/WorkerParts";
import { ShopHub } from "@/components/domain/jobs/worker/shop/ShopHub";
import type { ShopInitial } from "@/components/domain/jobs/worker/shop/ShopHub";
import { ShopJobPhotosScreen } from "@/components/domain/jobs/worker/shop/ShopJobPhotosScreen";
import { ShopOpenFlow } from "@/components/domain/jobs/worker/shop/ShopOpenFlow";
import type { MyIntakeJob } from "@/lib/jobs/shop-photo-server";

export const MSG_FORM_KEPT = "ข้อมูลที่กรอกยังอยู่ถ้าคนเดิมใส่ PIN (เปลี่ยนคนจะล้างฟอร์ม)";

export function ShopIntakeApp({ token, initial }: { token: string; initial: ShopInitial }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [flowActive, setFlowActive] = useState(false);
  const [jobScreen, setJobScreen] = useState<MyIntakeJob | null>(null);
  // หลัง refresh ข้อมูลใหม่ยังไม่มา แผงเก่าห้ามกดได้ — skeleton จนกว่า props ใหม่มาถึง (หรือครบ 8 วิ กันค้าง)
  const [waiting, setWaiting] = useState(false);
  const jobOwner = useRef<string | null>(null);

  useEffect(() => {
    setWaiting(false);
  }, [initial]);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setWaiting(false), 8000);
    return () => clearTimeout(t);
  }, [waiting]);

  const refresh = useCallback(() => {
    setWaiting(true);
    router.refresh();
  }, [router]);
  const exitFlow = useCallback(() => setFlowActive(false), []);
  const exitJob = useCallback(() => setJobScreen(null), []);

  const hub = initial.kind === "hub" ? initial.hub : null;
  const workerId = hub?.worker?.id ?? null;
  const canOpen = hub !== null && hub.state === "ready" && hub.openAllowed && (hub.profileReady || hub.goldProfileReady);
  const profile = { profileReady: hub?.profileReady === true, goldProfileReady: hub?.goldProfileReady === true };
  const busyView = !hydrated || waiting;
  const showFlow = flowActive && canOpen && !busyView;
  const showJob = jobScreen !== null && canOpen && !busyView && !flowActive;

  // จอแก้รูปเป็นของคนที่เปิดจอ — คนอื่นเข้ามาแทน = ปิดจอ
  useEffect(() => {
    if (jobScreen !== null && workerId !== null && jobOwner.current !== null && jobOwner.current !== workerId) setJobScreen(null);
  }, [jobScreen, workerId]);

  return (
    <div className="space-y-4">
      {busyView && <PanelSkeleton />}
      {flowActive && (
        <div hidden={!showFlow}>
          <ShopOpenFlow token={token} ready={profile} workerId={workerId} onExit={exitFlow} onSessionLost={refresh} />
        </div>
      )}
      {jobScreen !== null && (
        <div hidden={!showJob}>
          <ShopJobPhotosScreen key={jobScreen.jobId} token={token} job={jobScreen} onBack={exitJob} onSessionLost={refresh} />
        </div>
      )}
      {!busyView && !showFlow && !showJob && (
        <ShopHub
          token={token}
          initial={initial}
          onLoggedIn={refresh}
          onReload={refresh}
          onOpen={() => setFlowActive(true)}
          onOpenJob={(j) => {
            jobOwner.current = workerId;
            setJobScreen(j);
          }}
          onSessionLost={refresh}
          resumeNote={flowActive ? MSG_FORM_KEPT : null}
        />
      )}
    </div>
  );
}
