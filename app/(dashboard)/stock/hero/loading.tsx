import { Skeleton } from "@/components/ui/Skeleton";

export default function StockHeroLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดจอสต็อก Hero SKU">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
