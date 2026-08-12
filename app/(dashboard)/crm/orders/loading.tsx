import { Skeleton } from "@/components/ui/Skeleton";

export default function CrmOrdersLoading() {
  return (
    <div className="space-y-3" role="status" aria-label="กำลังโหลดรายการออเดอร์">
      <Skeleton className="h-11 w-full rounded-lg sm:w-72" />
      <div className="flex gap-2">
        <Skeleton className="h-11 flex-1 rounded-md" />
        <Skeleton className="h-11 w-28 rounded-md" />
        <Skeleton className="h-11 w-32 rounded-md" />
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-3.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between border-b border-zinc-100 py-2.5 last:border-0">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
