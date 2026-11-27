"use client";

// SavePreviewSheet — dialog สำรองของปุ่ม "บันทึกรูป" เมื่อ Web Share ใช้ไม่ได้ (ux-ring-save-image §3.2 ขั้น C): แสดงรูปให้กดค้างบันทึกลงเครื่อง
// โครงยกจาก LeaveSheet (portal ไป body · focus trap · Esc ปิด · แตะพื้นหลังปิด) — สีใช้ Tailwind primary-* + ค่ากลาง ไม่พึ่ง --gq-* (portal อยู่นอก wrapper ของเครื่องมือ)
// 🔴 client-only: ไม่มี fetch/storage/track · objectURL ถูก revoke โดยผู้เปิด (SaveImageButton) ตอนปิด/unmount
// ปุ่ม "บันทึกรูป" ใน sheet แสดงเฉพาะเมื่อเครื่องแชร์ไฟล์ได้ (canShare) — ปุ่มที่กดแล้วไม่เกิดอะไรแย่กว่าไม่มี · gesture ใหม่ + ไฟล์พร้อมแล้ว → share ถูกเรียกแบบ sync ใน click
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";

const FOCUSABLE = "button:not([disabled])";
const RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600";

export function SavePreviewSheet({
  url,
  alt,
  canShare,
  onShare,
  onClose,
}: {
  url: string;
  /** รายละเอียดทั้งหมดเป็นข้อความ (แบบ · พลอย · ไซซ์ · ราคา) */
  alt: string;
  canShare: boolean;
  onShare: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(26,18,18,0.72)] sm:items-center">
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="absolute inset-0 h-full w-full cursor-default" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[92dvh] w-full max-w-[480px] flex-col gap-3 overflow-y-auto rounded-t-[24px] bg-white px-[22px] pb-[max(20px,env(safe-area-inset-bottom))] pt-4 text-[#292929] sm:rounded-[24px]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="m-0 text-[20px] font-semibold leading-snug">
            {SHOWCASE_COPY.saveSheetTitle}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className={`inline-flex min-h-11 min-w-11 flex-none items-center justify-center rounded-full border border-zinc-300 bg-white px-4 text-[15px] font-medium transition-colors hover:bg-primary-50 ${RING}`}
          >
            {SHOWCASE_COPY.saveSheetClose}
          </button>
        </div>
        {/* รูปจากไฟล์ที่เพิ่งสร้างในเครื่อง (blob:) — ไม่ผ่าน next/image (ไม่ไป /_next/image) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} className="h-auto w-full rounded-xl border border-zinc-200" />
        <p className="m-0 text-[15px] leading-snug text-[#5c5651]">{SHOWCASE_COPY.saveSheetHint}</p>
        {canShare && (
          <button
            type="button"
            onClick={onShare}
            className={`inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full border-[1.5px] border-primary-600 bg-white px-5 text-base font-medium text-primary-600 transition-colors hover:bg-primary-50 ${RING}`}
          >
            <DownTrayIcon />
            {SHOWCASE_COPY.saveButton}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

export function DownTrayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
    </svg>
  );
}
