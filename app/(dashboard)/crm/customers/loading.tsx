import { Skeleton } from "@/components/ui/Skeleton";

export default function CrmCustomersLoading() {
  return (
    <div className="space-y-3" role="status" aria-label="กำลังโหลดรายชื่อลูกค้า">
      <div className="flex gap-2">
        <Skeleton className="h-11 flex-1 rounded-md" />
        <Skeleton className="h-11 w-28 rounded-md" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-zinc-200 bg-white p-3.5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}
