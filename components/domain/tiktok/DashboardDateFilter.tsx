"use client";

// Single-day date picker for /tiktok/dashboard — sibling of
// components/domain/crm/CrmDateRangeFilter.tsx (same "plain controlled
// navigation component" pattern: no client state of its own, it just pushes
// `?date=` and lets the page's data-fetching (DashboardPageClient's `date`
// prop) react — URL-driven so the day is bookmarkable/shareable) but single-
// day, not a from/to range, because the underlying RPC
// (analytics.tiktok_daily_dashboard) is a one-day snapshot by definition.
//
// NOT a reuse of components/domain/tiktok/DateRangeFilter.tsx — that one is
// month-granularity and holds its own client state (sales page's calendar
// picker), a different data shape and a different job.

import { useCallback } from "react";
import { useRouter } from "next/navigation";

export function DashboardDateFilter({
  date,
  minDate,
  maxDate,
  basePath = "/tiktok/dashboard",
}: {
  /** "YYYY-MM-DD" — currently effective day shown (defaults to the RPC's
   * resolved date when the URL has no ?date=, so the input always shows a
   * concrete day, never blank — same contract as CrmDateRangeFilter's from/to). */
  date: string;
  /** Clamp bounds from `meta` (lib/tiktok/types.ts) — null (no meta yet, or
   * genuinely unknown) leaves that side of the input unclamped rather than
   * blocking valid days. */
  minDate: string | null;
  maxDate: string | null;
  basePath?: string;
}) {
  const router = useRouter();

  // router.push (not replace) so each day change is its own history entry —
  // otherwise back/forward can't step through the days a user browsed
  // (QA-measured: history.length stuck at 2 after 2 date changes, back
  // dropping out of the app entirely to about:blank).
  const navigate = useCallback(
    (nextDate: string) => {
      const params = new URLSearchParams({ date: nextDate });
      router.push(`${basePath}?${params.toString()}`);
    },
    [router, basePath]
  );

  // "วันล่าสุด" clears ?date= entirely rather than pushing today's date —
  // the RPC's own "latest day with data" (p_date: null) is a more reliable
  // definition of "latest" than the calendar's today, which could be a day
  // with zero orders yet.
  //
  // Stays `router.replace()` (not push): when there's already no ?date= in
  // the URL, this must remain a true no-op (QA-verified idempotent) — a
  // `push` to the same URL would still spend a history entry on nothing.
  const navigateLatest = useCallback(() => {
    router.replace(basePath);
  }, [router, basePath]);

  // Clamp only what the <input> shows — a `date` prop outside [minDate,
  // maxDate] (e.g. ?date=2025-01-01 before minDate) would otherwise render
  // `min`/`max` and `value` disagreeing on the same input. This never
  // rewrites the URL or triggers a navigation — the page's own empty state
  // for that day is correct as-is and must keep showing.
  let displayDate = date;
  if (minDate && displayDate < minDate) displayDate = minDate;
  if (maxDate && displayDate > maxDate) displayDate = maxDate;

  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label="เลือกวันที่">
      <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        วันที่
        <input
          type="date"
          value={displayDate}
          min={minDate ?? undefined}
          max={maxDate ?? undefined}
          onChange={(e) => e.target.value && navigate(e.target.value)}
          className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
        />
      </label>
      <button
        type="button"
        onClick={navigateLatest}
        className="min-h-11 rounded-full border border-zinc-300 px-3 text-sm font-semibold text-zinc-600 hover:border-primary-600 hover:text-primary-700"
      >
        วันล่าสุด
      </button>
    </div>
  );
}
