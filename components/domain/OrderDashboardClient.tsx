"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PrioritySummaryBar } from "./PrioritySummaryBar";
import { FilterBar, type FilterBarValue } from "./FilterBar";
import { OrderListItem } from "./OrderListItem";
import { NewOrdersBanner } from "./NewOrdersBanner";
import { OrderListSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner, ErrorState } from "@/components/ui/ErrorState";
import { listOrders, getPrioritySummary, countNewOrdersSince } from "@/lib/actions/orders";
import type { OrderListRow, PrioritySummary } from "@/lib/types";

const POLL_INTERVAL_MS = 30_000;

export function OrderDashboardClient({
  initialOrders,
  initialCursor,
  initialSummary,
}: {
  initialOrders: OrderListRow[];
  initialCursor: string | null;
  initialSummary: PrioritySummary;
}) {
  const [filter, setFilter] = useState<FilterBarValue>({ channel: "all", status: "all", search: "" });
  const [orders, setOrders] = useState<OrderListRow[]>(initialOrders);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [summary, setSummary] = useState<PrioritySummary>(initialSummary);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const loadedAt = useRef(new Date().toISOString());
  const sentinelRef = useRef<HTMLDivElement>(null);

  const refetchFirstPage = useCallback(async (nextFilter: FilterBarValue) => {
    setLoadingList(true);
    setError(null);
    const result = await listOrders({ ...nextFilter, cursor: null });
    setLoadingList(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOrders(result.data.rows);
    setCursor(result.data.nextCursor);
    setNewOrdersCount(0);
    loadedAt.current = new Date().toISOString();
  }, []);

  // Debounce filter/search changes so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => {
      refetchFirstPage(filter);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.channel, filter.status, filter.search]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const result = await listOrders({ ...filter, cursor });
    setLoadingMore(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOrders((prev) => [...prev, ...result.data.rows]);
    setCursor(result.data.nextCursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, filter, loadingMore]);

  // Cursor-based infinite scroll via IntersectionObserver on a bottom sentinel.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  // Poll for new orders (design: NewOrdersBanner is user-merged, not
  // auto-prepended, to avoid layout jump).
  useEffect(() => {
    const interval = setInterval(async () => {
      const result = await countNewOrdersSince(loadedAt.current);
      if (result.ok) setNewOrdersCount(result.data);

      const summaryResult = await getPrioritySummary();
      if (summaryResult.ok) setSummary(summaryResult.data);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-4">
      <PrioritySummaryBar summary={summary} />
      <NewOrdersBanner count={newOrdersCount} onMerge={() => refetchFirstPage(filter)} />
      <FilterBar value={filter} onChange={setFilter} />

      {error && orders.length > 0 && <ErrorBanner message={error} onRetry={() => refetchFirstPage(filter)} />}

      {loadingList ? (
        <OrderListSkeleton />
      ) : error && orders.length === 0 ? (
        <ErrorState message={error} onRetry={() => refetchFirstPage(filter)} />
      ) : orders.length === 0 ? (
        <EmptyState
          title="ไม่พบออเดอร์"
          description="ลองปรับตัวกรอง หรือรอออเดอร์ใหม่เข้ามา"
        />
      ) : (
        <>
          <div className="space-y-3">
            {orders.map((o) => (
              <OrderListItem key={o.id} order={o} />
            ))}
          </div>
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && <p className="py-4 text-center text-sm text-slate-400">กำลังโหลดเพิ่ม...</p>}
          {!cursor && orders.length > 0 && <p className="py-4 text-center text-sm text-slate-400">ถึงรายการสุดท้ายแล้ว</p>}
        </>
      )}
    </div>
  );
}
