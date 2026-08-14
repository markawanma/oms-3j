"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { StockListItem } from "./StockListItem";
import { AdjustStockSheet } from "./AdjustStockSheet";
import { StockListSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner, ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { listStock, adjustStock } from "@/lib/actions/stock";
import type { StockRow } from "@/lib/types";

export function StockPageClient({ initialStock }: { initialStock: StockRow[] }) {
  const [stock, setStock] = useState<StockRow[]>(initialStock);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StockRow | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const refetch = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    const result = await listStock(term);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStock(result.data);
  }, []);

  // Skip only the very first run (mount) — `initialStock` from the server
  // already reflects search="" at that point, so re-fetching it would be a
  // wasted duplicate request. Do NOT special-case `search === ""` in general:
  // a user typing then clearing the search box also produces search === ""
  // and must refetch to show the full list again — an earlier version of
  // this guard checked the value instead of "is this mount", which broke
  // that clear-search flow (list stayed on stale filtered results).
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const handle = setTimeout(() => refetch(search), 300);
    return () => clearTimeout(handle);
  }, [search, refetch]);

  const handleAdjustSubmit = useCallback(
    async (productId: string, newOnHand: number) => {
      setBusy(true);
      const result = await adjustStock(productId, newOnHand);
      setBusy(false);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("ปรับสต็อกเรียบร้อย", "success");
      setStock((prev) => prev.map((s) => (s.productId === productId ? result.data : s)));
      setSelected(null);
    },
    [toast]
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
        <label htmlFor="stock-search" className="sr-only">
          ค้นหาสินค้า (SKU หรือ ชื่อ)
        </label>
        <input
          id="stock-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหา SKU หรือ ชื่อสินค้า"
          className="min-h-11 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-base focus-visible:border-primary-600"
        />
      </div>

      {error && stock.length > 0 && <ErrorBanner message={error} onRetry={() => refetch(search)} />}

      {loading ? (
        <StockListSkeleton />
      ) : error && stock.length === 0 ? (
        <ErrorState message={error} onRetry={() => refetch(search)} />
      ) : stock.length === 0 ? (
        <EmptyState title="ยังไม่มีสินค้าในสต็อก" description="เพิ่มสินค้าใหม่จากเมนู 'เพิ่มสินค้า'" />
      ) : (
        <div className="space-y-2">
          {stock.map((s) => (
            <StockListItem key={s.productId} stock={s} onAdjust={() => setSelected(s)} />
          ))}
        </div>
      )}

      <AdjustStockSheet stock={selected} busy={busy} onClose={() => setSelected(null)} onSubmit={handleAdjustSubmit} />
    </div>
  );
}
