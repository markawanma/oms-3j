import { Skeleton } from "@/components/ui/Skeleton";

export function DashboardKpiSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดแดชบอร์ด">
      <Skeleton className="h-14 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-zinc-200 bg-white p-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-6 w-16" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <Skeleton className="h-9 w-full rounded-lg" />
      <div className="space-y-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    </div>
  );
}
