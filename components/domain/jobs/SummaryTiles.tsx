"use client";

// SummaryTiles — 4 tile = ปุ่มกรอง (aria-pressed) · ตัวเลขนับจากใบหลังกรอง dropdown แต่ก่อนกรอง signal → เท่าผลที่เห็นเมื่อกด
// n=0 → เทา disabled ยกเว้น tile ที่กำลังเลือกอยู่ (รีเฟรชแล้วเหลือ 0 ต้องกดออกได้) · กดซ้ำ = ล้าง

import { AlertTriangle, CalendarClock, Check, Clock, ListChecks } from "lucide-react";
import type { BoardSummary, Signal } from "@/lib/jobs/board";
import { STATUS_TONE } from "@/components/domain/jobs/StatusChip";

type TileDef = { signal: Signal | null; label: string; icon: typeof Clock; tone: "red" | "amber" | null; n: (s: BoardSummary) => number };

const TILES: TileDef[] = [
  { signal: null, label: "ใบงานที่เปิดอยู่", icon: ListChecks, tone: null, n: (s) => s.active },
  { signal: "overdue", label: "เลยกำหนด", icon: AlertTriangle, tone: "red", n: (s) => s.overdue },
  { signal: "dueSoon", label: "ครบใน 3 วัน", icon: CalendarClock, tone: "amber", n: (s) => s.dueSoon },
  { signal: "stale", label: "นิ่งเกิน 3 วัน", icon: Clock, tone: "amber", n: (s) => s.stale },
];

export function SummaryTiles({ summary, signal, onSelect }: { summary: BoardSummary; signal: Signal | null; onSelect: (s: Signal | null) => void }) {
  return (
    <section aria-label="สรุป" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {TILES.map((t) => {
        const n = t.n(summary);
        const selected = t.signal === signal;
        const Icon = t.icon;
        // tile "ทั้งหมด" = ล้างตัวกรอง signal: เลือกอยู่เมื่อไม่มี signal · กดแล้วไม่มีอะไรเปลี่ยนถ้าไม่ได้กรองอยู่ (ไม่ disable เมื่อ n>0)
        const disabled = n === 0 && !selected;
        const tone = n > 0 && t.tone ? STATUS_TONE[t.tone] : "border-zinc-200 bg-white text-zinc-900";
        const dim = disabled ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-600" : tone;
        return (
          <button
            key={t.label}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onSelect(t.signal === null || selected ? null : t.signal)}
            className={`relative min-h-16 rounded-lg border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-1 ${dim} ${selected && t.signal !== null ? "ring-2 ring-primary-600 ring-offset-1" : ""} ${disabled ? "" : "hover:brightness-95"}`}
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t.label}
            </span>
            <span className="block text-2xl font-bold tabular-nums">{n}</span>
            {selected && t.signal !== null && <Check className="absolute right-2 top-2 h-4 w-4" aria-hidden="true" />}
          </button>
        );
      })}
    </section>
  );
}
