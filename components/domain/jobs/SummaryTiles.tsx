"use client";

// SummaryTiles — 5 tile (W1 เพิ่ม "รอรับทราบ") = ปุ่มกรอง (aria-pressed) · ตัวเลขนับจากใบหลังกรอง dropdown แต่ก่อนกรอง signal → เท่าผลที่เห็นเมื่อกด
// n=0 → เทา disabled ยกเว้น tile ที่กำลังเลือกอยู่ (รีเฟรชแล้วเหลือ 0 ต้องกดออกได้) · กดซ้ำ = ล้าง

import { AlertTriangle, CalendarClock, Check, ClipboardCheck, Clock, ListChecks } from "lucide-react";
import type { BoardSummary, Signal } from "@/lib/jobs/board";
import { STATUS_TONE } from "@/components/domain/jobs/StatusChip";

type TileDef = { signal: Signal | null; label: string; icon: typeof Clock; tone: "red" | "amber" | null; n: (s: BoardSummary) => number; /** tone ที่ขึ้นเมื่อ n>0 (ไม่ส่ง = ใช้ tone) */ toneOf?: (s: BoardSummary) => "red" | "amber" | null };

const TILES: TileDef[] = [
  { signal: null, label: "ใบงานที่เปิดอยู่", icon: ListChecks, tone: null, n: (s) => s.active },
  { signal: "overdue", label: "เลยกำหนด", icon: AlertTriangle, tone: "red", n: (s) => s.overdue },
  { signal: "dueSoon", label: "ครบใน 3 วัน", icon: CalendarClock, tone: "amber", n: (s) => s.dueSoon },
  { signal: "stale", label: "นิ่งเกิน 3 วัน", icon: Clock, tone: "amber", n: (s) => s.stale },
  // W1: tile ที่ 5 — amber เมื่อ n>0 · แดงถ้ามีใบค้างเกินกำหนดเตือน · ไม่ซ่อนเมื่อ n=0 (เลย์เอาต์ไม่กระโดด)
  { signal: "unacked", label: "รอรับทราบ", icon: ClipboardCheck, tone: "amber", n: (s) => s.unacked, toneOf: (s) => (s.unackedStale > 0 ? "red" : "amber") },
];

/** อ่านสถานะรับทราบไม่ได้ — ห้ามโชว์ 0 (จะเข้าใจว่าไม่มีใบค้าง) */
export const UNACKED_UNKNOWN_TITLE = "อ่านสถานะรับทราบไม่ได้";

export function SummaryTiles({ summary, signal, onSelect, unackedUnknown = false }: { summary: BoardSummary; signal: Signal | null; onSelect: (s: Signal | null) => void; unackedUnknown?: boolean }) {
  return (
    <section aria-label="สรุป" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {TILES.map((t) => {
        const n = t.n(summary);
        const unknown = t.signal === "unacked" && unackedUnknown;
        const selected = t.signal === signal;
        const Icon = t.icon;
        // tile "ทั้งหมด" = ล้างตัวกรอง signal: เลือกอยู่เมื่อไม่มี signal · กดแล้วไม่มีอะไรเปลี่ยนถ้าไม่ได้กรองอยู่ (ไม่ disable เมื่อ n>0)
        const disabled = (n === 0 || unknown) && !selected;
        const toneKey = n > 0 && !unknown ? (t.toneOf ? t.toneOf(summary) : t.tone) : null;
        const tone = toneKey ? STATUS_TONE[toneKey] : "border-zinc-200 bg-white text-zinc-900";
        const dim = disabled ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-600" : tone;
        return (
          <button
            key={t.label}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            title={unknown ? UNACKED_UNKNOWN_TITLE : undefined}
            onClick={() => onSelect(t.signal === null || selected ? null : t.signal)}
            className={`relative min-h-16 rounded-lg border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-1 ${dim} ${selected && t.signal !== null ? "ring-2 ring-primary-600 ring-offset-1" : ""} ${disabled ? "" : "hover:brightness-95"}`}
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t.label}
            </span>
            <span className="block text-2xl font-bold tabular-nums">{unknown ? "—" : n}</span>
            {unknown && <span className="sr-only">{UNACKED_UNKNOWN_TITLE}</span>}
            {selected && t.signal !== null && <Check className="absolute right-2 top-2 h-4 w-4" aria-hidden="true" />}
          </button>
        );
      })}
    </section>
  );
}
