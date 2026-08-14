import { Skeleton } from "@/components/ui/Skeleton";

export function UploadQueueSkeleton() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="กำลังเตรียมไฟล์">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white p-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-14 rounded" />
        </div>
      ))}
    </div>
  );
}
