"use client";

// กล่องเตือนของหน้า "พลอยที่ต้องสั่งซื้อ" — แสดงเหนือรายการเสมอ ไม่ขึ้นกับว่ารายการว่างไหม (ยอดที่เห็นอาจไม่ครบ)
//  - UnspecifiedJobsNotice (§4.8): ใบที่ยังเปิด + ขั้นฝังพลอยยังไม่รับ + ไม่มีรายการพลอยเลย → ยอดข้างล่างยังไม่รวมใบเหล่านี้
//  - RemovedAfterOrderNotice (security M2 ของ 0192): ใบเคยติ๊กสั่งไว้แล้วรายการถูกลบจากใบ → ถ้าเพิ่มกลับจะนับเป็น "ยังไม่สั่ง" เสี่ยงสั่งซ้ำ
// พับเป็นค่าเริ่ม · role="status" (ข้อมูลคงอยู่ ไม่ใช่การแจ้งเหตุฉุกเฉิน) · ลิงก์ไป /jobs/[id] แท็บเดียวกัน · 0 รายการ = ไม่ render

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { thaiDate } from "@/lib/jobs/dates";
import { jobItemKey } from "@/lib/jobs/gems-to-buy";
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

export const REMOVED_DISMISSED_STORAGE_KEY = "gems-to-buy:removed-dismissed";
/** คีย์ของรายการเตือน — รายการใหม่ (ใบ/รายการ/เวลาลบต่างจากเดิม) = คีย์ใหม่ = โผล่อีกเสมอ */
export const removedKey = (e: GemPurchaseRemovedAfterOrder): string => `${e.jobId}:${e.canonicalItemId}:${e.removedAt ?? ""}`;

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(REMOVED_DISMISSED_STORAGE_KEY);
    const v: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function writeDismissed(keys: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(REMOVED_DISMISSED_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    /* จำค่าไม่ได้ — ปิดได้เฉพาะรอบนี้ */
  }
}

/**
 * คำเตือนแถวที่ถูกลบหลังสั่ง อาจค้างตลอดอายุใบ (แถวที่ลบแล้วไม่เพิ่มกลับ) → ปิดได้ทีละรายการ/ทั้งหมด จำใน localStorage (try/catch)
 * รายการใหม่ (คีย์ใหม่) โผล่เองเสมอ · "แสดงที่ปิดไว้" เรียกกลับได้ · คีย์ที่ไม่มีในข้อมูลปัจจุบันถูกทิ้ง (storage ไม่โตเรื่อยๆ)
 * ค่าเริ่ม (ก่อนอ่าน storage/อ่านไม่ได้) = แสดงทุกรายการ — พลาดทางปลอดภัย (ดีกว่าซ่อนคำเตือนสั่งซ้ำโดยไม่รู้ตัว)
 */
export function RemovedAfterOrderNotice({ items, forceShowKeys }: { items: ReadonlyArray<GemPurchaseRemovedAfterOrder>; forceShowKeys?: ReadonlySet<string> }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const panelId = useId();

  const itemKeys = items.map(removedKey).join("|");
  useEffect(() => {
    const current = new Set(itemKeys === "" ? [] : itemKeys.split("|"));
    const stored = readDismissed();
    const kept = new Set([...stored].filter((k) => current.has(k)));
    setDismissed(kept);
    if (kept.size !== stored.size) writeDismissed(kept);
  }, [itemKeys]);

  if (items.length === 0) return null;
  // forced = ใบนั้นมีแถวรายการเดียวกัน "ยังไม่สั่ง" อยู่ตอนนี้ (เสี่ยงสั่งซ้ำจริง) — แสดงเสมอ แม้เคยปิดไว้ · ปิดไม่ได้จนกว่าสถานการณ์จะหมด
  const forced = (e: GemPurchaseRemovedAfterOrder): boolean => forceShowKeys?.has(jobItemKey(e.jobId, e.canonicalItemId)) === true;
  const hiddenCount = items.filter((e) => dismissed.has(removedKey(e)) && !forced(e)).length;
  const shown = showDismissed ? items : items.filter((e) => forced(e) || !dismissed.has(removedKey(e)));

  function dismiss(keys: string[]) {
    const next = new Set([...dismissed, ...keys]);
    setDismissed(next);
    writeDismissed(next);
  }
  function restore() {
    setDismissed(new Set());
    setShowDismissed(false);
    writeDismissed(new Set());
  }

  if (shown.length === 0) {
    return (
      <p role="status" className="text-sm text-zinc-700">
        ซ่อนคำเตือนสั่งซ้ำไว้ {hiddenCount} รายการ{" "}
        <button type="button" onClick={() => setShowDismissed(true)} className="min-h-11 rounded-md px-2 font-semibold text-primary-700 underline underline-offset-2">
          แสดงที่ปิดไว้
        </button>
      </p>
    );
  }
  return (
    <div role="status" className={BOX}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-start gap-2 text-sm font-semibold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>เคยสั่งพลอยไว้แต่รายการถูกลบออกจากใบ {shown.length} รายการ — ถ้าเพิ่มกลับ ระบบจะนับเป็นยังไม่สั่ง ระวังสั่งซ้ำ</span>
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <Toggle open={open} onClick={() => setOpen((v) => !v)} controls={panelId}>
            {open ? "ซ่อนรายการ ▴" : "ดูรายการ ▾"}
          </Toggle>
          {!showDismissed && shown.some((e) => !forced(e)) && (
            <button type="button" onClick={() => dismiss(shown.filter((e) => !forced(e)).map(removedKey))} className="min-h-11 shrink-0 rounded-md px-3 text-sm font-semibold underline underline-offset-2 hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-900">
              ปิดคำเตือนทั้งหมด
            </button>
          )}
        </div>
      </div>
      {open && (
        <ul id={panelId} className="mt-2 space-y-1 text-sm">
          {shown.map((e) => (
            <li key={removedKey(e)} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 break-words [overflow-wrap:anywhere]">
              <span>
                ใบ <b>{e.jobNo}</b> เคยสั่ง {e.label ?? "รายการที่ถูกลบจากแคตตาล็อกแล้ว"} ไว้ <span className="whitespace-nowrap">{e.qty.toLocaleString("en-US")} เม็ด</span> แต่รายการถูกลบ
                {forced(e) ? " — ใบนี้มีรายการนี้ที่ยังไม่สั่งอยู่ในแท็บยังไม่สั่งตอนนี้" : dismissed.has(removedKey(e)) && " (ปิดไว้แล้ว)"}
              </span>
              <span className="flex items-center gap-1">
                <Link href={`/jobs/${e.jobId}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                  เปิดใบ →
                </Link>
                {!dismissed.has(removedKey(e)) && !forced(e) && (
                  <button type="button" onClick={() => dismiss([removedKey(e)])} aria-label={`ปิดคำเตือน ใบ ${e.jobNo}`} className="min-h-11 rounded-md px-3 text-sm font-semibold underline underline-offset-2 hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-900">
                    ปิดรายการนี้
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(showDismissed || hiddenCount > 0) && (
        <p className="mt-2 text-xs">
          {showDismissed ? "กำลังแสดงรายการที่ปิดไว้ด้วย " : `ซ่อนไว้อีก ${hiddenCount} รายการ `}
          <button type="button" onClick={showDismissed ? restore : () => setShowDismissed(true)} className="min-h-11 rounded-md px-2 font-semibold underline underline-offset-2">
            {showDismissed ? "เลิกปิดทั้งหมด" : "แสดงที่ปิดไว้"}
          </button>
        </p>
      )}
    </div>
  );
}
