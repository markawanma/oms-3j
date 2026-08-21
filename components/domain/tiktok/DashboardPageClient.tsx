"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Coins } from "lucide-react";
import { getDailyDashboard } from "@/lib/actions/tiktok-dashboard";
import type { DailyDashboardData } from "@/lib/tiktok/types";
import { effectiveDateBangkok, formatThaiDateOnly } from "@/lib/tiktok/format";
import { DashboardDateFilter } from "./DashboardDateFilter";
import { DataQualityBanner } from "./DataQualityBanner";
import { KpiCard } from "./KpiCard";
import { BreakdownTabs } from "./BreakdownTabs";
import { DashboardKpiSkeleton } from "./DashboardKpiSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner, ErrorState } from "@/components/ui/ErrorState";

/**
 * Client component so it can `await getDailyDashboard(date)` (lib/actions/
 * tiktok-dashboard.ts, real data via analytics.tiktok_daily_dashboard RPC —
 * swapped in per design §5 "สลับไฟล์เดียว UI ไม่แก้", same call shape as the
 * fixture it replaced) and drive the loading/error/empty/success states from
 * design §4.
 *
 * `date` is the URL-driven `?date=` value (page.tsx -> here), matching the
 * /dashboard page's pattern: DashboardDateFilter below only ever navigates
 * the URL (`router.replace`), it never holds its own state — this component
 * re-fetches whenever the `date` prop changes.
 *
 * NOTE: channel / address_type filter chips shown in the approved mockup are
 * still NOT implemented here (only the date filter shipped this round) —
 * flagged as technical debt in the delivery summary, not silently dropped.
 */
export function DashboardPageClient({ date }: { date: string | null }) {
  const [data, setData] = useState<DailyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stale-response guard: switching `date` quickly can let an older request
  // resolve AFTER a newer one (network jitter). Without this, the older
  // response's setData/setError would silently overwrite the newer one even
  // though the URL has already moved on — wrong numbers with zero visual
  // signal (QA-reproduced: 08-20's 80 orders shown while ?date=2026-08-17,
  // which should read 143). A monotonically increasing request id, checked
  // right after the await, is enough — no AbortController needed since
  // getDailyDashboard() is a server action call, not an abortable fetch.
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const result = await getDailyDashboard(date ?? undefined);
    if (requestIdRef.current !== requestId) return; // superseded by a newer request — drop this one
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setData(result.data);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return <DashboardKpiSkeleton />;
  }

  if (error && !data) {
    return <ErrorState message={error} onRetry={load} />;
  }

  if (!data) {
    // Defensive only — getDailyDashboard() returns has_data:false as a valid
    // `ok:true` payload (zero-order day), never a null-data success.
    return <EmptyState icon={Coins} title="ยังไม่มีข้อมูลแดชบอร์ด" />;
  }

  const isEmptyDay = data.kpis.orderCount.value === 0;

  // Effective day the picker/label show: prefer the RPC's resolved `date`
  // (what the numbers below actually reflect) over the raw `date` prop, so
  // the two never disagree — falls back to the URL value, then Bangkok
  // "today", only for the edge case where the RPC returns "" (shop with zero
  // orders ever, per the `date` field's own fallback comment above).
  const effectiveDate = data.date || date || effectiveDateBangkok(new Date().toISOString());

  return (
    <div className="space-y-4">
      {/* Stale-data banner: only reachable if a future refetch fails while we
          still have a previous successful `data` to show (design §4: "ถ้ามี
          cache เก่า → ErrorBanner เหนือตัวเลขเก่า"). */}
      {error && <ErrorBanner message={error} onRetry={load} />}

      <DashboardDateFilter
        date={effectiveDate}
        minDate={data.meta?.minDate ?? null}
        maxDate={data.meta?.maxDate ?? null}
      />

      <p className="text-xs text-zinc-400">
        ข้อมูลวันที่ <span className="font-semibold text-zinc-600">{formatThaiDateOnly(data.date)}</span> ·{" "}
        ข้อมูลจริงจาก OMS
      </p>

      <DataQualityBanner dataQuality={data.dataQuality} />

      {/* Incomplete-day warning (meta.isPossiblyIncomplete, computed server-
          side in lib/actions/tiktok-dashboard.ts — this component only ever
          renders the pre-computed boolean + label). Absent entirely when
          meta is undefined (pre-0070 RPC) or the day is complete/unknown —
          fail-quiet, never a guessed warning. */}
      {data.meta?.isPossiblyIncomplete && data.meta.incompleteLabel && (
        <div role="note" className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-amber-900">{data.meta.incompleteLabel}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="ตัวชี้วัดหลัก">
        <KpiCard kpi={data.kpis.salesToday} />
        <KpiCard kpi={data.kpis.orderCount} />
        <KpiCard kpi={data.kpis.profitEstimate} />
        <KpiCard kpi={data.kpis.aov} />
      </div>

      {isEmptyDay ? (
        <EmptyState
          icon={Coins}
          title="ไม่มีออเดอร์ในช่วงนี้"
          description="ตัวเลข KPI ด้านบนเป็น 0 ตามจริง (ไม่ใช่ error) — ลองเปลี่ยนวันที่ด้านบน"
        />
      ) : (
        <BreakdownTabs breakdown={data.breakdown} />
      )}
    </div>
  );
}
