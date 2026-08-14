"use client";

import { useCallback, useState } from "react";
import { getSalesSummary } from "@/lib/actions/tiktok-sales";
import type { SalesSummary } from "@/lib/tiktok/types";
import { DateRangeFilter } from "./DateRangeFilter";
import { SalesScopeNote } from "./SalesScopeNote";
import { SalesKpiRow } from "./SalesKpiRow";
import { SalesTrendChart } from "./SalesTrendChart";
import { ChannelMixChart } from "./ChannelMixChart";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner, ErrorState } from "@/components/ui/ErrorState";
import { Coins } from "lucide-react";

/** Last calendar day of a "YYYY-MM" month, as "YYYY-MM-DD". */
function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of `m`
  return d.toISOString().slice(0, 10);
}

function firstDayOfMonth(ym: string): string {
  return `${ym}-01`;
}

function SalesKpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5" role="status" aria-label="กำลังโหลดยอดขาย">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-zinc-200 bg-white p-3.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

export function SalesPageClient({
  initialSummary,
  initialFrom,
  initialTo,
}: {
  initialSummary: SalesSummary;
  /** "YYYY-MM-DD" */
  initialFrom: string;
  /** "YYYY-MM-DD" */
  initialTo: string;
}) {
  const [fromMonth, setFromMonth] = useState(initialFrom.slice(0, 7));
  const [toMonth, setToMonth] = useState(initialTo.slice(0, 7));
  const [summary, setSummary] = useState<SalesSummary>(initialSummary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextFromMonth: string, nextToMonth: string) => {
    setLoading(true);
    setError(null);
    const result = await getSalesSummary({
      from: firstDayOfMonth(nextFromMonth),
      to: lastDayOfMonth(nextToMonth),
      granularity: "month",
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSummary(result.data);
  }, []);

  const handleRangeChange = useCallback(
    (nextFromMonth: string, nextToMonth: string) => {
      setFromMonth(nextFromMonth);
      setToMonth(nextToMonth);
      load(nextFromMonth, nextToMonth);
    },
    [load]
  );

  const isEmpty = summary.totals.orders === 0;

  return (
    <div className="space-y-4">
      <DateRangeFilter fromMonth={fromMonth} toMonth={toMonth} onChange={handleRangeChange} />
      <SalesScopeNote scope={summary.scope} />

      {error && !isEmpty && (
        <ErrorBanner message={error} onRetry={() => load(fromMonth, toMonth)} />
      )}

      {loading ? (
        <SalesKpiSkeleton />
      ) : error && isEmpty ? (
        <ErrorState message={error} onRetry={() => load(fromMonth, toMonth)} />
      ) : isEmpty ? (
        <EmptyState
          icon={Coins}
          title="ไม่มีข้อมูลยอดขายในช่วงนี้"
          description={'ลองขยายช่วงวันที่ หรือเลือก "ทั้งหมด"'}
        />
      ) : (
        <>
          <SalesKpiRow summary={summary} />
          <SalesTrendChart points={summary.points} granularity={summary.granularity} />
          <ChannelMixChart points={summary.points} />
        </>
      )}

      <p className="border-t border-zinc-200 pt-3 text-xs leading-relaxed text-zinc-400">
        <span className="font-medium text-zinc-500">สรุปยอดขาย</span> — ข้อมูลจริงจาก OMS (aggregate รายเดือน) ·
        เลือกช่วงวันที่ด้านบนเพื่อกรอง · กำไรไม่แสดง เพราะต้นทุนกรอกไม่ครบ (เชื่อไม่ได้)
      </p>
    </div>
  );
}
