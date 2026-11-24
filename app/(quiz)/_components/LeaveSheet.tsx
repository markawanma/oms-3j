"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { HUB_URL } from "@/lib/site/hosts";

// LeaveSheet — bottom sheet ถาม "ออกจากขั้นตอนนี้?" เมื่อกดไป hub ทั้งที่มีงานค้าง (ux-tools-navigation §5.1)
//
// a11y: role alertdialog + aria-modal + labelledby/describedby · โฟกัสเริ่มต้น = "อยู่ต่อ" (ทางปลอดภัย — แตะพลาดเกิดบ่อยกว่าเจตนาจะออก) ·
//       focus trap (Tab/Shift+Tab วนใน 2 ปุ่ม) · Esc = อยู่ต่อ · แตะพื้นหลัง = อยู่ต่อ · ปุ่ม ≥ 52px
// "ออกไปหน้าเครื่องมือ" = <a href={HUB_URL}> ธรรมดา (ไม่ target/window.open — ผ่านเบราว์เซอร์ปกติ ไม่ถูกบล็อกใน LINE)
// ไม่ใช้สีแดงเตือน (ไม่ได้ลบข้อมูลถาวรของลูกค้า — เริ่มใหม่ได้ใน < 1 นาที) · ไม่ใช้ beforeunload
//
// render ผ่าน portal ไป document.body: จอ quiz ห่อด้วย motion-safe:animate-gq-fade-up (fill-mode both ค้าง transform) และ <main> มี
// overflow-hidden ที่ sm → position:fixed ข้างในจะถูกตัด/ยึดกับกล่องนั้นแทนหน้าจอ · ผลที่ตามมา: CSS variable ของแต่ละเครื่องมือ (--gq-*/--rs-*)
// ไม่ลงมาถึง portal → ใช้ค่าสีตรงๆ (แบรนด์ #a2191d = primary-600) ไม่พึ่ง variable
// ข้อความ body ส่งเข้ามา (quiz: lib/gem-quiz/config · วัดไซส์: lib/ring-size/config) — ห้ามมีเลขราคา

export const LEAVE_COPY = {
  title: "ออกจากขั้นตอนนี้?",
  stay: "อยู่ต่อ",
  leave: "ออกไปหน้าเครื่องมือ",
} as const;

const FOCUSABLE = 'a[href], button:not([disabled])';
const RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a2191d]";

export function LeaveSheet({ body, onStay }: { body: string; onStay: () => void }) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const onStayRef = useRef(onStay);
  onStayRef.current = onStay;

  useEffect(() => {
    stayRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onStayRef.current();
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
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onStay} className="absolute inset-0 h-full w-full cursor-default" />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="relative flex w-full max-w-[480px] flex-col gap-4 rounded-t-[24px] bg-white px-[22px] pb-[max(20px,env(safe-area-inset-bottom))] pt-5 text-[#292929] sm:rounded-[24px]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="m-0 text-[20px] font-semibold leading-snug">
            {LEAVE_COPY.title}
          </h2>
          <p id={bodyId} className="m-0 text-[15px] leading-snug text-[#5c5651]">
            {body}
          </p>
        </div>
        <div className="flex flex-col gap-2.5">
          <button
            ref={stayRef}
            type="button"
            onClick={onStay}
            className={`inline-flex min-h-[52px] w-full items-center justify-center rounded-full bg-[#a2191d] px-5 text-base font-semibold text-white transition-colors hover:bg-[#801418] ${RING}`}
          >
            {LEAVE_COPY.stay}
          </button>
          <a
            href={HUB_URL}
            className={`inline-flex min-h-[52px] w-full items-center justify-center rounded-full border-[1.5px] border-[#a2191d] bg-white px-5 text-base font-medium text-[#a2191d] transition-colors hover:bg-[#faf5f5] ${RING}`}
          >
            {LEAVE_COPY.leave}
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}
