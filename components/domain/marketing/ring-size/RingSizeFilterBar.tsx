"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { thaiDate } from "@/lib/jobs/dates";
import {
  RING_RANGE_KEYS,
  RING_STATS_MAX_DAYS,
  addDaysISO,
  checkRingStatsRange,
  ringSizeHref,
  type RingRangeKey,
  type RingSizeFilters,
} from "@/lib/marketing/ring-size-filters";

// ux-ring-size-stats.md §4 — แถบกรอง: chip 7/30/90/180 (สัมพัทธ์ใน URL) + "กำหนดเอง" (ต้องกด "ดูข้อมูล" — ไม่ push ตอน onChange)
// ไม่มีตัวกรองช่องทาง (มติ 25 ต.ค. 69) · ทุกปุ่ม/ช่องกรอก min-h-11 · focus ring เหมือน Button
const CHIP_LABEL: Record<RingRangeKey, string> = { "7d": "7 วัน", "30d": "30 วัน", "90d": "90 วัน", "180d": "180 วัน" };

const CHIP_BASE =
  "min-h-11 rounded-full px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2";
const CHIP_ON = "bg-primary-100 text-primary-700";
const CHIP_OFF = "border border-zinc-300 text-zinc-600 hover:border-primary-600 hover:text-primary-700";

export function RingSizeFilterBar({
  filters,
  today,
  dataSince,
  pending,
  onNavigate,
}: {
  filters: RingSizeFilters;
  today: string;
  /** วันเริ่มมีข้อมูล (จากผล RPC) — ไม่มี = ไม่โชว์ */
  dataSince: string | null;
  pending: boolean;
  onNavigate: (href: string) => void;
}) {
  const [customOpen, setCustomOpen] = useState(filters.range === "custom");
  const [customFrom, setCustomFrom] = useState(filters.from);
  const [customTo, setCustomTo] = useState(filters.to);
  const [customError, setCustomError] = useState<string | null>(null);

  const minDate = addDaysISO(today, -(RING_STATS_MAX_DAYS - 1));

  function submitCustom() {
    const err = checkRingStatsRange(customFrom, customTo);
    if (err) {
      setCustomError(err);
      return;
    }
    if (customTo > today) {
      setCustomError("วันที่สิ้นสุดต้องไม่เกินวันนี้");
      return;
    }
    if (customFrom < minDate) {
      setCustomError(`ระบบเก็บข้อมูลย้อนหลัง ${RING_STATS_MAX_DAYS} วัน`);
      return;
    }
    setCustomError(null);
    onNavigate(ringSizeHref({ range: "custom", from: customFrom, to: customTo }));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="ช่วงเวลา">
        {RING_RANGE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filters.range === key}
            onClick={() => {
              setCustomOpen(false);
              setCustomError(null);
              onNavigate(ringSizeHref({ range: key }));
            }}
            className={`${CHIP_BASE} ${filters.range === key ? CHIP_ON : CHIP_OFF}`}
          >
            {CHIP_LABEL[key]}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={filters.range === "custom"}
          aria-expanded={customOpen}
          aria-controls="rs-custom-range"
          onClick={() => {
            if (!customOpen) {
              // เปิดแถวกำหนดเองครั้งใหม่ ⇒ เริ่มจากช่วงที่กำลังดูอยู่ (ไม่ใช่ค่าค้างจากรอบก่อน)
              setCustomFrom(filters.from);
              setCustomTo(filters.to);
              setCustomError(null);
            }
            setCustomOpen((v) => !v);
          }}
          className={`${CHIP_BASE} ${filters.range === "custom" ? CHIP_ON : CHIP_OFF}`}
        >
          กำหนดเอง
        </button>
      </div>

      {customOpen && (
        <form
          id="rs-custom-range"
          className="flex flex-wrap items-end gap-2"
          aria-label="กำหนดช่วงวันที่เอง"
          onSubmit={(e) => {
            e.preventDefault();
            submitCustom();
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
            ตั้งแต่
            <input
              type="date"
              value={customFrom}
              min={minDate}
              max={today}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
            ถึง
            <input
              type="date"
              value={customTo}
              min={minDate}
              max={today}
              onChange={(e) => setCustomTo(e.target.value)}
              className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
            />
          </label>
          <Button type="submit" size="md">
            ดูข้อมูล
          </Button>
          {customError && (
            <p role="alert" className="basis-full text-sm text-red-700">
              {customError}
            </p>
          )}
        </form>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-zinc-600">
        <p>
          แสดง {thaiDate(filters.from)} – {thaiDate(filters.to)}
          {dataSince ? ` · เริ่มมีข้อมูล ${thaiDate(dataSince)}` : ""}
        </p>
        <p role="status" aria-live="polite">
          {pending ? "กำลังอัปเดต…" : ""}
        </p>
      </div>
      <p className="text-xs text-zinc-600">ระบบเก็บข้อมูลย้อนหลัง {RING_STATS_MAX_DAYS} วัน</p>
    </div>
  );
}
