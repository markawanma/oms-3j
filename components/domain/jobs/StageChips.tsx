"use client";

// StageChips — แทน <select> ขั้น (มือถือ + โหมดรายการบน PC): chip เลื่อนแนวนอน · "ทุกขั้น (n)" + เฉพาะขั้นที่มีงาน
// ภาษาภาพเดียวกับแท็บ WorkersClient (aria-pressed · min-h-11 · เลือก bg-primary-100)

import type { BoardColumn } from "@/lib/jobs/board";

function chipCls(on: boolean): string {
  return `inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${on ? "bg-primary-100 text-primary-700" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`;
}

export function StageChips({ columns, total, stage, onSelect, emptyCount }: { columns: readonly BoardColumn[]; total: number; stage: string; onSelect: (code: string) => void; emptyCount: number }) {
  const withRows = columns.filter((c) => c.rows.length > 0);
  return (
    <div role="group" aria-label="กรองตามขั้น" className="flex items-center gap-1.5 overflow-x-auto pb-1">
      <button type="button" aria-pressed={stage === "all"} onClick={() => onSelect("all")} className={chipCls(stage === "all")}>
        ทุกขั้น ({total})
      </button>
      {withRows.map((c) => (
        <button key={c.code} type="button" aria-pressed={stage === c.code} onClick={() => onSelect(c.code)} className={chipCls(stage === c.code)}>
          {c.name} ({c.rows.length})
        </button>
      ))}
      {emptyCount > 0 && <span className="shrink-0 pl-1 text-xs text-zinc-700">อีก {emptyCount} ขั้นยังไม่มีงาน</span>}
    </div>
  );
}
