"use client";

// MonthOverlay — "ดูเป็นเดือน" (design ux-content-calendar.md §2: "grid
// มาตรฐาน 7×N, ต่อวันแสดง count chip เท่านั้น ... เป็น navigator ไม่ใช่
// editor"). Self-contained: owns its own open/close state so DayAgenda (a
// plain/server component) can drop it in without lifting any state up.
// Picking a day pushes `?tab=plan&d=` (same URL-driven pattern as DateStrip)
// and closes itself.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, X } from "lucide-react";
import type { DayDots } from "@/components/domain/marketing/DateStrip";

const WEEKDAY_HEADER = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTH_YEAR_FMT = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" });

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function MonthOverlay({
  dots,
  year,
  month,
  selectedDate,
  today,
}: {
  /** Same per-day dot map DateStrip uses — one fetch (design §4), grouped
   * client-side, reused here rather than re-fetching for the overlay. */
  dots: Record<string, DayDots>;
  year: number;
  /** 1-12 */
  month: number;
  selectedDate: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const startWeekday = firstOfMonth.getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: (string | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoDate(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function pick(date: string) {
    setOpen(false);
    router.push(`/marketing/calendar?tab=plan&d=${date}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-600 hover:border-primary-300 hover:text-primary-700"
      >
        <CalendarRange className="h-4 w-4" aria-hidden="true" />
        ดูเป็นเดือน
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="เลือกวันจากมุมมองรายเดือน"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-xl bg-white p-4 shadow-lg sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-zinc-900">{MONTH_YEAR_FMT.format(firstOfMonth)}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="ปิด"
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[0.7rem] font-semibold text-zinc-400">
              {WEEKDAY_HEADER.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((date, i) => {
                if (!date) return <span key={`blank-${i}`} />;
                const info = dots[date];
                const isSelected = date === selectedDate;
                const isToday = date === today;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => pick(date)}
                    className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md border text-xs ${
                      isSelected ? "border-primary-600 bg-primary-50" : "border-transparent hover:bg-zinc-50"
                    }`}
                  >
                    <span className={isToday ? "font-bold text-primary-700" : "text-zinc-700"}>
                      {Number(date.slice(-2))}
                    </span>
                    {info && info.count > 0 && (
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${info.alert ? "bg-red-500" : "bg-zinc-400"}`}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
