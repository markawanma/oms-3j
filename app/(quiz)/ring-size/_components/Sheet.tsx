"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { COPY } from "@/lib/ring-size/config";
import { CrossIcon } from "./Icons";
import { FOCUS, SERIF, TEXT } from "./styles";

// Sheet — bottom sheet แบบ dialog ที่ใช้ร่วม: ภาพตัวอย่าง (4.2) · G3 (alertdialog) · R7 แชร์รูป
//
// a11y (B17): role dialog/alertdialog + aria-modal + aria-labelledby · focus trap · Esc ปิด ·
// ปุ่มปิด 44 px · คืนโฟกัสไปที่ element ที่เปิด · สูงสุด 85dvh เลื่อนได้ · พื้นหลังมืด rgba(26,18,18,.72)

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  title,
  role = "dialog",
  onClose,
  closeLabel = COPY.common.close,
  showClose = true,
  dismissOnBackdrop = true,
  children,
}: {
  title: string;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  closeLabel?: string;
  showClose?: boolean;
  dismissOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    // โฟกัสไปหัวข้อ (alertdialog: อ่านหัวข้อก่อน) — ไม่เด้งไปปุ่มแรกเพื่อกันกดพลาด
    titleRef.current?.focus();

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
      if (items.length === 0) {
        e.preventDefault();
        titleRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === titleRef.current || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(26,18,18,0.72)] sm:items-center">
      {dismissOnBackdrop ? (
        <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="absolute inset-0 h-full w-full cursor-default" />
      ) : null}
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[85dvh] w-full max-w-[480px] flex-col overflow-y-auto rounded-t-[24px] bg-[var(--rs-surface)] px-[22px] pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:rounded-[24px]"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className={`${SERIF} text-[20px] font-semibold leading-snug ${TEXT} outline-none`}>
            {title}
          </h2>
          {showClose ? (
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              className={`-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${TEXT} hover:bg-[var(--rs-blush)] ${FOCUS}`}
            >
              <CrossIcon size={20} strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
