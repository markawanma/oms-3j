import { Skeleton } from "@/components/ui/Skeleton";

export default function CrmImportErrorsLoading() {
  return (
    <div className="space-y-3" role="status" aria-label="กำลังโหลดข้อมูล import error">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-zinc-200 bg-white p-3.5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-3 w-full" />
        </div>
      ))}
    </div>
  );
}
