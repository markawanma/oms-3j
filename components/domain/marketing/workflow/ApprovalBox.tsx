"use client";

// ApprovalBox — รายการ "ก่อนอนุมัติ" (คำอธิบาย) + เวลาที่เปิดอ่าน
// 🔴 รายการนี้ "อธิบาย" เท่านั้น — ปุ่มอนุมัติ (PieceActionBar) enabled ⇔ can_approve จาก DB ห้ามคำนวณซ้ำ (F1/F7)
// ถ้า can_approve=false แต่รายการอธิบายว่าง → บอกตรงๆ ว่าระบบยังไม่ให้ผ่าน (ปุ่มยัง disabled — F1) แนะนำให้รีเฟรช

import { CheckCircle2, Circle } from "lucide-react";
import { ReadTimer } from "@/components/domain/marketing/workflow/ReviewClock";
import { buildApprovalChecklist, countUndone } from "@/lib/marketing/approval-checklist";
import type { PieceRow } from "@/lib/marketing/piece-types";

export function ApprovalBox({ piece }: { piece: PieceRow }) {
  const items = buildApprovalChecklist(piece);
  const undone = countUndone(items);
  return (
    <section aria-label="ก่อนอนุมัติ" className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <h3 className="text-sm font-semibold text-zinc-900">ก่อนอนุมัติ</h3>
      <ul className="mt-2 space-y-1">
        {items.map((i) => (
          <li key={i.label} className="flex items-start gap-2 text-sm">
            {i.done ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            )}
            <span className={i.done ? "text-zinc-700" : "font-medium text-zinc-900"}>
              {i.label}
              <span className="sr-only">{i.done ? " (เรียบร้อย)" : " (ยังไม่เรียบร้อย)"}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm font-medium text-zinc-900">
        {piece.canApprove
          ? "พร้อมอนุมัติ"
          : undone > 0
            ? `ยังอนุมัติไม่ได้ — เหลือ ${undone} อย่าง`
            : "ยังอนุมัติไม่ได้ — ระบบยังไม่ให้ผ่าน แต่ไม่มีรายการให้ไล่ดู (ลองรีเฟรชหน้านี้)"}
      </p>
      <div className="mt-1">
        <ReadTimer />
      </div>
    </section>
  );
}
