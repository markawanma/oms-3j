"use client";

// กล่องเตือนของหน้า "พลอยที่ต้องสั่งซื้อ" — แสดงเหนือรายการเสมอ ไม่ขึ้นกับว่ารายการว่างไหม (ยอดที่เห็นอาจไม่ครบ)
//  - UnspecifiedJobsNotice (§4.8): ใบที่ยังเปิด + ขั้นฝังพลอยยังไม่รับ + ไม่มีรายการพลอยเลย → ยอดข้างล่างยังไม่รวมใบเหล่านี้
//  - RemovedAfterOrderNotice (security M2 ของ 0192): ใบเคยติ๊กสั่งไว้แล้วรายการถูกลบจากใบ → ถ้าเพิ่มกลับจะนับเป็น "ยังไม่สั่ง" เสี่ยงสั่งซ้ำ
// พับเป็นค่าเริ่ม · role="status" (ข้อมูลคงอยู่ ไม่ใช่การแจ้งเหตุฉุกเฉิน) · ลิงก์ไป /jobs/[id] แท็บเดียวกัน · 0 รายการ = ไม่ render

import { useId, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { thaiDate } from "@/lib/jobs/dates";
import type { GemPurchaseRemovedAfterOrder, GemPurchaseUnspecifiedJob } from "@/lib/jobs/gem-purchase";

const BOX = "rounded-lg border border-amber-300 bg-amber-100 p-3 text-amber-950";

function Toggle({ open, onClick, controls, children }: { open: boolean; onClick: () => void; controls: string; children: string }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} onClick={onClick} className="min-h-11 shrink-0 rounded-md px-3 text-sm font-semibold underline underline-offset-2 hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-900">
      {children}
    </button>
  );
}

export function UnspecifiedJobsNotice({ jobs }: { jobs: ReadonlyArray<GemPurchaseUnspecifiedJob> }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (jobs.length === 0) return null;
  return (
    <div role="status" className={BOX}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-start gap-2 text-sm font-semibold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>ใบที่ยังไม่ได้ใส่พลอย {jobs.length} ใบ — ยอดด้านล่างยังไม่รวมใบเหล่านี้</span>
        </p>
        <Toggle open={open} onClick={() => setOpen((v) => !v)} controls={panelId}>
          {open ? "ซ่อนใบ ▴" : "ดูใบ ▾"}
        </Toggle>
      </div>
      {open && (
        <ul id={panelId} className="mt-2 space-y-1 text-sm">
          {jobs.map((j) => (
            <li key={j.jobId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 break-words [overflow-wrap:anywhere]">
              <span>
                <b>{j.jobNo}</b>
                {j.designLabel !== null && ` · ${j.designLabel}`} · {j.dueDate === null ? "ไม่ระบุกำหนด" : `กำหนด ${thaiDate(j.dueDate, false)}`}
              </span>
              <Link href={`/jobs/${j.jobId}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                เปิดใบเพื่อใส่พลอย →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RemovedAfterOrderNotice({ items }: { items: ReadonlyArray<GemPurchaseRemovedAfterOrder> }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (items.length === 0) return null;
  return (
    <div role="status" className={BOX}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-start gap-2 text-sm font-semibold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>เคยสั่งพลอยไว้แต่รายการถูกลบออกจากใบ {items.length} รายการ — ถ้าเพิ่มกลับ ระบบจะนับเป็นยังไม่สั่ง ระวังสั่งซ้ำ</span>
        </p>
        <Toggle open={open} onClick={() => setOpen((v) => !v)} controls={panelId}>
          {open ? "ซ่อนรายการ ▴" : "ดูรายการ ▾"}
        </Toggle>
      </div>
      {open && (
        <ul id={panelId} className="mt-2 space-y-1 text-sm">
          {items.map((e) => (
            <li key={`${e.jobId}:${e.canonicalItemId}:${e.removedAt ?? ""}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 break-words [overflow-wrap:anywhere]">
              <span>
                ใบ <b>{e.jobNo}</b> เคยสั่ง {e.label ?? "รายการที่ถูกลบจากแคตตาล็อกแล้ว"} ไว้ <span className="whitespace-nowrap">{e.qty.toLocaleString("en-US")} เม็ด</span> แต่รายการถูกลบ
              </span>
              <Link href={`/jobs/${e.jobId}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                เปิดใบ →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
