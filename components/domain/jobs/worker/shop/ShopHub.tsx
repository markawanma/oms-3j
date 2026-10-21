"use client";

// ShopHub — W-1 hub ของ QR ร้าน (/w/s/<token>) · UX B.2: 4 สภาพหลัก + W-1e/W-1f
//   W-1a ยังไม่ PIN → รายชื่อเฉพาะคนที่ได้สิทธิ์เปิดงาน (มติ Q8) + IdentifyPanel เดิม (ใช้ intakeLogin) · ไม่เขียนเลข 5/10/15 บนจอ
//   W-1b มี session แต่ไม่มีสิทธิ์ → ข้อความ + [ไม่ใช่ฉัน] (จบ)
//   W-1c มีสิทธิ์ → ปุ่มเดียว "เปิดงานใหม่"
//   W-1d QR ถูกยกเลิก/ไม่พบ (ข้อความเดียวกัน ไม่บอกว่า token เคยมีจริงไหม) · W-1e เชื่อมต่อไม่ได้ · W-1f ร้านยังไม่พร้อม (ไม่ชี้ URL ออฟฟิศ)
// ไม่มีลิงก์ออกนอกแอปช่าง · "คิวงานของฉัน" ซ่อนจนถึง L4

import { useState } from "react";
import { AlertTriangle, Info, WifiOff } from "lucide-react";
import { IdentifyPanel } from "@/components/domain/jobs/worker/WorkerPanels";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { intakeLogin, workerLogout } from "@/lib/actions/job-worker";
import type { IntakeHubView } from "@/lib/jobs/worker-server";

/** สิ่งที่หน้า server ส่งให้ client — hub ปกติ · QR ใช้ไม่ได้ · โหลดล้ม */
export type ShopInitial = { kind: "hub"; hub: IntakeHubView } | { kind: "closed" } | { kind: "error"; message: string };

export const MSG_EMPTY_WORKERS = "ยังไม่มีใครได้รับสิทธิ์เปิดงานจากมือถือ — แจ้งออฟฟิศ";
export const MSG_HUB_OFFLINE = "เชื่อมต่อไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง";
export const MSG_NOT_READY = "ยังเปิดงานจากมือถือไม่ได้ — ร้านยังไม่ได้ตั้งแบบการบันทึกงาน แจ้งออฟฟิศให้ตั้งก่อน";

function Brand({ children = "3J · เปิดงานใหม่" }: { children?: string }) {
  return <p className="text-base font-semibold text-zinc-700">{children}</p>;
}

function NotMeButton({ onNotMe, busy, tone }: { onNotMe: () => void; busy: boolean; tone: "secondary" | "link" }) {
  if (tone === "secondary")
    return (
      <BigButton type="button" tone="secondary" onClick={onNotMe} loading={busy}>
        ไม่ใช่ฉัน — เลือกชื่อใหม่
      </BigButton>
    );
  return (
    <button type="button" onClick={onNotMe} disabled={busy} className="min-h-12 w-full rounded-lg text-lg font-semibold text-primary-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:opacity-50">
      ไม่ใช่ฉัน — เลือกชื่อใหม่
    </button>
  );
}

export function ShopHub({
  token,
  initial,
  onLoggedIn,
  onReload,
  onOpen,
  resumeNote,
}: {
  token: string;
  initial: ShopInitial;
  /** ใส่ PIN ผ่านแล้ว / เปลี่ยนคนแล้ว — ให้ผู้เรียกโหลด hub ใหม่ */
  onLoggedIn: () => void;
  onReload: () => void;
  onOpen: () => void;
  /** มีฟอร์มค้างอยู่ (session หมดเวลาระหว่างกรอก) — บอกว่าข้อมูลยังอยู่ */
  resumeNote?: string | null;
}) {
  const [outBusy, setOutBusy] = useState(false);

  async function notMe() {
    setOutBusy(true);
    try {
      await workerLogout();
    } catch {
      // ล้มก็โหลดใหม่ — ถ้า session ยังอยู่จะเห็นสถานะจริง
    } finally {
      setOutBusy(false);
      onLoggedIn();
    }
  }

  if (initial.kind === "closed") {
    return (
      <div role="alert" className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="h-12 w-12 text-amber-600" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-zinc-900">QR ร้านนี้ใช้ไม่ได้แล้ว</h1>
        <p className="text-lg text-zinc-800">QR ถูกยกเลิกหรือเปลี่ยนใหม่</p>
        <p className="text-lg text-zinc-800">ขอ QR ใหม่จากออฟฟิศ</p>
      </div>
    );
  }

  if (initial.kind === "error") {
    return (
      <div className="space-y-4 pt-6 text-center">
        <WifiOff className="mx-auto h-12 w-12 text-zinc-600" aria-hidden="true" />
        <h1 role="alert" className="text-2xl font-bold text-zinc-900">
          {initial.message}
        </h1>
        <BigButton type="button" onClick={onReload}>
          ลองอีกครั้ง
        </BigButton>
        <p className="text-lg text-zinc-700">ใช้กระดาษไปก่อนถ้าเน็ตยังไม่มา</p>
      </div>
    );
  }

  const hub = initial.hub;

  if (hub.state === "identify") {
    return (
      <div className="space-y-4">
        <header className="space-y-1">
          <Brand />
          <h1 className="text-2xl font-bold text-zinc-900">ใครกำลังเปิดงาน?</h1>
        </header>
        {hub.sessionExpired && (
          <p role="alert" className="rounded-xl bg-amber-50 p-3 text-lg font-semibold text-amber-900">
            หมดเวลาแล้ว — ใส่ PIN ใหม่{resumeNote ? ` · ${resumeNote}` : ""}
          </p>
        )}
        <IdentifyPanel token={token} workers={hub.workers} onDone={onLoggedIn} login={intakeLogin} heading="เลือกชื่อของคุณ" emptyMessage={MSG_EMPTY_WORKERS} />
      </div>
    );
  }

  const name = hub.worker?.displayName ?? "";

  if (!hub.openAllowed) {
    return (
      <div className="space-y-4">
        <header className="space-y-1">
          <Brand />
          <h1 className="text-2xl font-bold break-words text-zinc-900">สวัสดี {name}</h1>
        </header>
        <div role="note" className="flex gap-3 rounded-xl border-2 border-sky-300 bg-sky-50 p-4 text-lg text-sky-950">
          <Info className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
          <p>
            <strong>บัญชีนี้ยังไม่มีสิทธิ์เปิดงานใหม่</strong>
            <br />
            ถ้าต้องการเปิดงาน แจ้งออฟฟิศให้ติ๊กสิทธิ์ &ldquo;เปิดงานได้&rdquo; ให้ก่อน
          </p>
        </div>
        <NotMeButton onNotMe={() => void notMe()} busy={outBusy} tone="secondary" />
      </div>
    );
  }

  // ร้านยังไม่มีแบบการบันทึกเลย (ทั้งเงิน/ทองเหลือง และทอง) — เปิดงานไม่ได้ทุกกรณี บอกตั้งแต่ hub ไม่ใช่หลังกรอก 8 ช่อง (UX R1)
  if (!hub.profileReady && !hub.goldProfileReady) {
    return (
      <div className="space-y-4">
        <header className="space-y-1">
          <Brand />
          <h1 className="text-2xl font-bold break-words text-zinc-900">สวัสดี {name}</h1>
        </header>
        <p role="alert" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-lg font-semibold text-amber-950">
          {MSG_NOT_READY}
        </p>
        <NotMeButton onNotMe={() => void notMe()} busy={outBusy} tone="secondary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <Brand>3J · ร้าน</Brand>
        <h1 className="text-2xl font-bold break-words text-zinc-900">สวัสดี {name}</h1>
      </header>
      <BigButton type="button" className="min-h-[60px]" onClick={onOpen}>
        เปิดงานใหม่
      </BigButton>
      <NotMeButton onNotMe={() => void notMe()} busy={outBusy} tone="link" />
    </div>
  );
}
