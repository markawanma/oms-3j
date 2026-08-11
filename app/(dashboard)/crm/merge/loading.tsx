import { Skeleton } from "@/components/ui/Skeleton";

export default function CrmMergeLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดรายการลูกค้าซ้ำ">
      <div>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-3.5 w-64" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-white p-3.5">
          <Skeleton className="h-4 w-20" />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="mt-3 h-9 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}
