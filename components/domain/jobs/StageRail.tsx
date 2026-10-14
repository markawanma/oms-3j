"use client";

// StageRail (PC โหมดบอร์ด) — ทุกขั้นตามลำดับสายผลิต: มีงาน = ปุ่มเลื่อนไปคอลัมน์ · ว่าง = ป้ายประ (ไม่ใช่ปุ่ม) บอกว่าขั้นนั้นมีอยู่แต่ไม่มีงาน

import type { BoardColumn } from "@/lib/jobs/board";

export function StageRail({ columns, onJump }: { columns: readonly BoardColumn[]; onJump: (code: string) => void }) {
  return (
    <nav aria-label="ขั้นตอนทั้งหมด">
      <ol className="flex flex-wrap items-center gap-1.5">
        {columns.map((c) => (
          <li key={c.code}>
            {c.rows.length > 0 ? (
              <button
                type="button"
                onClick={() => onJump(c.code)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary-100 px-3 text-sm font-semibold text-primary-800 hover:bg-primary-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
              >
                {c.name}
                <span className="tabular-nums">{c.rows.length}</span>
              </button>
            ) : (
              <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-zinc-300 bg-zinc-50 px-3 text-sm text-zinc-600">
                {c.name} <span className="tabular-nums">0</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
