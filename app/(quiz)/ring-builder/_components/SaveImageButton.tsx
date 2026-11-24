"use client";

// SaveImageButton — ปุ่มรอง "บันทึกรูป" ในกล่องสรุป (เจ้าของสั่ง 25 พ.ย.: "เผื่อยังไม่อยากส่งแต่อยาก save ไว้เลือกดูก่อน") — ux-ring-save-image.md
// ทำงานทั้งหมดในเครื่อง: จับภาพ 3D มุมหน้า (captureFront) → compose ภาพพร้อมรายละเอียด → Web Share ถ้าได้ ไม่ได้ = sheet ให้กดค้างบันทึก
// 🔴 ไม่มี fetch/sendBeacon/storage/cookie/trackCta ในไฟล์นี้และ lib/ring-builder/save-image/* (S2/S3/S4 · เทสต์ spy) · ไม่มีรูปถ่ายจริงแทน 3D (S5)
// 🔴 ไม่ขึ้น "บันทึกแล้ว ✓": share() resolve = ผู้ใช้ปิดเมนูแชร์ ไม่ได้แปลว่ารูปลงอัลบั้ม (S7) · ผู้ใช้ยกเลิก = ไม่ใช่ error (S8)
// คืน fragment เพื่อวางเป็น grid item ในแถวปุ่มรองของ OrderSummary — ข้อความสถานะใต้แถวใช้ col-span-full
// ภาพที่ได้ = ค่าตอนกด (makeSaveImage จับภาพ + อ่านแถวใน task เดียวก่อน await) · unmount ระหว่างทำ = ไม่ setState ไม่เปิด sheet
import { useEffect, useId, useRef, useState } from "react";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import type { ShowcaseLineInput } from "@/lib/ring-builder/showcase/line-message";
import { canShareFile, deliverImage } from "@/lib/ring-builder/save-image/deliver";
import { makeSaveImage } from "@/lib/ring-builder/save-image/make-image";
import type { CaptureFrontFn } from "@/lib/ring-builder/viewer/gl-renderer";
import { DownTrayIcon, SavePreviewSheet } from "./SavePreviewSheet";

type Phase = "idle" | "busy" | "failed";
interface SheetState {
  url: string;
  file: File;
  alt: string;
  canShare: boolean;
}

export function SaveImageButton({ input, ready, capture }: { input: ShowcaseLineInput; ready: boolean; capture: CaptureFrontFn | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const waitId = useId();

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // objectURL ถูกคืนเมื่อ sheet ปิด/เปลี่ยน/unmount (S13)
  const sheetUrl = sheet?.url ?? null;
  useEffect(() => {
    if (!sheetUrl) return;
    return () => URL.revokeObjectURL(sheetUrl);
  }, [sheetUrl]);

  const canClick = ready && capture !== null;
  const busy = phase === "busy";

  async function onClick() {
    if (busyRef.current || !canClick || !capture) return;
    busyRef.current = true;
    setPhase("busy");
    const made = await makeSaveImage({ capture, input, themeEl: btnRef.current?.parentElement ?? btnRef.current ?? document.body });
    if (!aliveRef.current) return;
    if (!made.ok) {
      busyRef.current = false;
      setPhase("failed");
      return;
    }
    const result = await deliverImage(made.file);
    if (!aliveRef.current) return;
    busyRef.current = false;
    setPhase("idle");
    if (result === "needSheet") {
      setSheet({ url: URL.createObjectURL(made.file), file: made.file, alt: made.alt, canShare: canShareFile(made.file) });
    }
    // shared / aborted = จบเงียบ (ไม่ยืนยันว่าบันทึกแล้ว · ไม่ใช่ error)
  }

  function closeSheet() {
    setSheet(null);
    btnRef.current?.focus(); // คืนโฟกัสไปปุ่มที่เปิด
  }

  function shareFromSheet() {
    // gesture ใหม่ + ไฟล์พร้อมแล้ว — deliverImage เรียก share() แบบ sync ในรอบนี้ · ผลไม่เปลี่ยน UI (ไม่อ้างว่าบันทึกแล้ว)
    if (sheet) void deliverImage(sheet.file);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        disabled={!canClick || busy}
        aria-busy={busy || undefined}
        aria-describedby={!ready ? waitId : undefined}
        className="inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full border border-[var(--gq-border)] bg-white px-4 text-base font-medium text-[var(--gq-text)] transition-colors hover:bg-[var(--gq-burgundy-soft)] disabled:cursor-not-allowed disabled:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
      >
        <DownTrayIcon />
        {busy ? SHOWCASE_COPY.saveBusy : SHOWCASE_COPY.saveButton}
      </button>
      <p role="status" className="sr-only">
        {busy ? SHOWCASE_COPY.saveBusy : ""}
      </p>
      {!ready && (
        <p id={waitId} className="col-span-full text-sm text-[var(--gq-text-muted)]">
          {SHOWCASE_COPY.saveWaitStage}
        </p>
      )}
      {phase === "failed" && (
        <p role="alert" className="col-span-full flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm leading-[1.55] text-amber-900">
          <svg className="mt-0.5 flex-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l10 18H2z" />
            <path d="M12 10v5M12 18.2v.1" />
          </svg>
          <span>{SHOWCASE_COPY.saveFailed}</span>
        </p>
      )}
      {sheet && <SavePreviewSheet url={sheet.url} alt={sheet.alt} canShare={sheet.canShare} onShare={shareFromSheet} onClose={closeSheet} />}
    </>
  );
}
