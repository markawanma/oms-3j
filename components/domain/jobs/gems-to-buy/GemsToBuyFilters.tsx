"use client";

// GemsToBuyFilters — ค้นหา · ชนิด · รูปทรง · เร่งด่วน · เรียง (ux-gems-to-buy.md §4.2) · state อยู่ที่ GemsToBuyClient (sync ลง URL ที่นั่น)
// ค้นหาไม่สนช่องว่าง/ตัวพิมพ์ (normalizeGemName ที่ lib) · ปุ่มเร่งด่วน aria-pressed + จำนวนหลังกรองอื่น · เรียง = segmented 2 ปุ่ม aria-pressed (ไม่ทำเรียงทุกคอลัมน์)

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { GEM_FIELD } from "@/components/domain/gems/ui";
import { hasActiveFilter } from "@/lib/jobs/gems-to-buy";
import type { GtbFilters, GtbSort } from "@/lib/jobs/gems-to-buy";

const SEG = "min-h-11 px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600";

export function GemsToBuyFilters({
  filters,
  typeOptions,
  shapeOptions,
  urgentCount,
  onChange,
  onClear,
  costSwitch,
}: {
  filters: GtbFilters;
  typeOptions: ReadonlyArray<readonly [string, string]>;
  shapeOptions: ReadonlyArray<readonly [string, string]>;
  urgentCount: number;
  onChange: (patch: Partial<GtbFilters>) => void;
  onClear: () => void;
  /** สวิตช์ต้นทุน (เฉพาะแท็บ "ยังไม่สั่ง") */
  costSwitch?: ReactNode;
}) {
  const sortBtn = (value: GtbSort, label: string) => (
    <button
      type="button"
      aria-pressed={filters.sort === value}
      onClick={() => onChange({ sort: value })}
      className={`${SEG} ${filters.sort === value ? "bg-primary-100 text-primary-700" : "bg-white text-zinc-700 hover:bg-zinc-100"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-2" role="search" aria-label="ตัวกรองรายการพลอย">
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-[minmax(12rem,1fr)_10rem_10rem]">
        <input
          type="search"
          className={`${GEM_FIELD} sm:col-span-2 md:col-span-1`}
          placeholder="ค้นหา เช่น โกเมน 4×6…"
          aria-label="ค้นหาพลอย"
          value={filters.q}
          maxLength={80}
          onChange={(e) => onChange({ q: e.target.value })}
        />
        <select className={GEM_FIELD} aria-label="กรองตามชนิด" value={filters.typeId} onChange={(e) => onChange({ typeId: e.target.value })}>
          <option value="">ทุกชนิด</option>
          {typeOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <select className={GEM_FIELD} aria-label="กรองตามรูปทรง" value={filters.shapeId} onChange={(e) => onChange({ shapeId: e.target.value })}>
          <option value="">ทุกรูปทรง</option>
          {shapeOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={filters.urgent}
          onClick={() => onChange({ urgent: !filters.urgent })}
          className={`min-h-11 rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${filters.urgent ? "border-red-300 bg-red-50 text-red-800" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}
        >
          <span aria-hidden="true">⚠ </span>เร่งด่วน {urgentCount}
        </button>
        <div role="group" aria-label="เรียงรายการ" className="inline-flex items-center overflow-hidden rounded-md border border-zinc-300">
          <span className="px-2 text-xs text-zinc-700">เรียง</span>
          {sortBtn("urgent", "เร่งด่วนก่อน")}
          {sortBtn("type", "ตามชนิด")}
        </div>
        {hasActiveFilter(filters) && (
          <Button type="button" variant="ghost" onClick={onClear}>
            ล้างตัวกรอง
          </Button>
        )}
        {costSwitch && <div className="sm:ml-auto">{costSwitch}</div>}
      </div>
    </div>
  );
}
