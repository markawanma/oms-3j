"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { getDailyDashboard } from "@/lib/actions/tiktok-dashboard";
import type { DailyDashboardData } from "@/lib/tiktok/types";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { DataQualityBanner } from "./DataQualityBanner";
import { KpiCard } from "./KpiCard";
import { BreakdownTabs } from "./BreakdownTabs";
import { DashboardKpiSkeleton } from "./DashboardKpiSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner, ErrorState } from "@/components/ui/ErrorState";

/**
 * Client component so it can `await getDailyDashboard()` (lib/actions/
 * tiktok-dashboard.ts, real data via analytics.tiktok_daily_dashboard RPC —
 * swapped in per design §5 "สลับไฟล์เดียว UI ไม่แก้", same call shape as the
 * fixture it replaced) and drive the loading/error/empty/success states from
 * design §4.
 *
 * NOTE: filter chips (date range / channel / address_type) shown in the
 * approved mockup are NOT implemented here — getDailyDashboard() accepts an
 * optional dateISO but the UI never passes one yet, and this chunk's scope
 * (see handoff) only lists KpiCard / DataQualityBanner / BreakdownTabs /
 * DashboardKpiSkeleton. Flagged as technical debt in the delivery summary,
 * not silently dropped.
 */
export function DashboardPageClient() {
  const [data, setData] = useState<DailyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getDailyDashboard();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setData(result.data);
  }, []);

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

  return (
    <div className="space-y-4">
      {/* Stale-data banner: only reachable if a future refetch fails while we
          still have a previous successful `data` to show (design §4: "ถ้ามี
          cache เก่า → ErrorBanner เหนือตัวเลขเก่า"). */}
      {error && <ErrorBanner message={error} onRetry={load} />}

      <p className="text-xs text-zinc-400">
        ข้อมูลวันที่ <span className="font-semibold text-zinc-600">{formatThaiDateOnly(data.date)}</span> ·{" "}
        ข้อมูลจริงจาก OMS
      </p>

      <DataQualityBanner dataQuality={data.dataQuality} />

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
          description="ตัวเลข KPI ด้านบนเป็น 0 ตามจริง (ไม่ใช่ error) — ลองเปลี่ยนวันที่เมื่อมี filter"
        />
      ) : (
        <BreakdownTabs breakdown={data.breakdown} />
      )}
    </div>
  );
}
