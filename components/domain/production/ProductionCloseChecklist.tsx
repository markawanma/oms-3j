"use client";

// ProductionCloseChecklist — เช็คลิสต์ก่อนกด "ผลิตเสร็จ" (UX A.2): แสดงเฉพาะข้อที่ยังติด (ไม่ใช่ checklist ยาวทุกใบ)
// ทุกข้อมีปุ่มลัด scroll+focus ไปที่การ์ดที่ต้องแก้ (ไม่ใช่ลิงก์ออก) · ตัวส่วนหัว focus ได้ (tabIndex -1) ให้ปุ่ม aria-disabled พามาที่นี่
// W1: ข้อ "ยังไม่รับทราบ" พาไปการ์ดรับทราบ (anchorId) · ข้อรายการพาไปการ์ดรายการ (itemId)

import type { CloseBlocker } from "@/lib/production/metal-ui";

export const CLOSE_CHECKLIST_ID = "production-close-checklist";

function focusById(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView?.({ behavior: "smooth", block: "center" });
  el.focus({ preventScroll: true });
}

export function focusItemCard(itemId: string) {
  focusById(`po-item-${itemId}`);
}

export function ProductionCloseChecklist({ blockers }: { blockers: readonly CloseBlocker[] }) {
  if (blockers.length === 0) return null;
  return (
    <section id={CLOSE_CHECKLIST_ID} tabIndex={-1} aria-label="ก่อนกดผลิตเสร็จ" className="rounded-lg border border-amber-300 bg-amber-50 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
      <h2 className="text-sm font-bold text-amber-950">ก่อนกด &quot;ผลิตเสร็จ&quot; ต้องทำอีก {blockers.length} ข้อ</h2>
      <ul className="mt-2 space-y-1.5">
        {blockers.map((b, i) => (
          <li key={`${b.code}-${b.itemId ?? i}`} className="flex flex-wrap items-start justify-between gap-2 text-sm text-amber-950">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              <span aria-hidden="true">✗ </span>
              {b.message}
            </span>
            {(b.itemId || b.anchorId) && (
              <button
                type="button"
                onClick={() => (b.itemId ? focusItemCard(b.itemId) : focusById(b.anchorId as string))}
                className="min-h-9 shrink-0 rounded-md border border-amber-400 bg-white px-2.5 text-xs font-medium text-amber-950 hover:bg-amber-100"
              >
                {b.itemId ? "ไปที่รายการ" : "ไปที่การ์ดรับทราบ"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
