"use client";

// Day-granularity date range picker for /crm/overview — sibling of
// components/domain/tiktok/DateRangeFilter.tsx (same visual pattern: two
// inputs + preset buttons) but day-level, not month-level, because CRM's
// data currently spans only 1-10 Aug (design handoff §5) where a month
// picker would be useless. Unlike the TikTok filter this one is a plain
// controlled navigation component: it doesn't hold its own state, it just
// pushes `?from=&to=` and lets the server component (page.tsx) re-fetch —
// see /crm/overview page.tsx header comment for why (URL-driven, not
// client-state-driven, so the range is bookmarkable/shareable).

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { effectiveDateBangkok } from "@/lib/tiktok/format";

function bangkokTodayISO(): string {
  return effectiveDateBangkok(new Date().toISOString());
}

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstDayOfThisMonthISO(): string {
  return `${bangkokTodayISO().slice(0, 7)}-01`;
}

export function CrmDateRangeFilter({
  from,
  to,
  minDate,
  maxDate,
  basePath = "/crm/overview",
}: {
  /** "YYYY-MM-DD" — currently effective range (defaults to minDate/maxDate
   * when the URL has no ?from=/?to=, so the inputs always show a concrete
   * selected range, never blank). */
  from: string;
  to: string;
  minDate: string | null;
  maxDate: string | null;
  /** Which page's URL to navigate — defaults to /crm/overview (original
   * caller); /crm/orders passes its own path so this stays a single shared
   * component instead of forking a near-identical copy. */
  basePath?: string;
}) {
  const router = useRouter();
  const today = bangkokTodayISO();

  const navigate = useCallback(
    (nextFrom: string, nextTo: string) => {
      const params = new URLSearchParams({ from: nextFrom, to: nextTo });
      router.push(`${basePath}?${params.toString()}`);
    },
    [router, basePath]
  );

  const navigateAll = useCallback(() => {
    router.push(basePath);
  }, [router, basePath]);

  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label="ช่วงวันที่">
      <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        ตั้งแต่
        <input
          type="date"
          value={from}
          min={minDate ?? undefined}
          max={today}
          onChange={(e) => e.target.value && navigate(e.target.value, to)}
          className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        ถึง
        <input
          type="date"
          value={to}
          min={minDate ?? undefined}
          max={today}
          onChange={(e) => e.target.value && navigate(from, e.target.value)}
          className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
        />
      </label>
      <div className="ml-auto flex gap-1.5">
        <button
          type="button"
          onClick={navigateAll}
          className="min-h-11 rounded-full border border-zinc-300 px-3 text-sm font-semibold text-zinc-600 hover:border-primary-600 hover:text-primary-700"
        >
          ทั้งหมด
        </button>
        <button
          type="button"
          onClick={() => navigate(addDaysISO(today, -6), today)}
          className="min-h-11 rounded-full border border-zinc-300 px-3 text-sm font-semibold text-zinc-600 hover:border-primary-600 hover:text-primary-700"
        >
          7 วันล่าสุด
        </button>
        <button
          type="button"
          onClick={() => navigate(firstDayOfThisMonthISO(), today)}
          className="min-h-11 rounded-full border border-zinc-300 px-3 text-sm font-semibold text-zinc-600 hover:border-primary-600 hover:text-primary-700"
        >
          เดือนนี้
        </button>
      </div>
    </div>
  );
}
