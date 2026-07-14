export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} aria-hidden="true" />;
}

export function OrderListSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="กำลังโหลดรายการออเดอร์">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="mt-3 h-4 w-40" />
          <Skeleton className="mt-2 h-4 w-28" />
        </div>
      ))}
    </div>
  );
}

export function StockListSkeleton() {
  return (
    <div className="space-y-2" role="status" aria-label="กำลังโหลดข้อมูลสต็อก">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4">
          <div>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

export function OrderDetailSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดรายละเอียดออเดอร์">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
