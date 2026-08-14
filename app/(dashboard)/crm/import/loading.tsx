import { Skeleton } from "@/components/ui/Skeleton";

export default function CrmImportLoading() {
  return (
    <div className="space-y-5" role="status" aria-label="กำลังโหลดหน้านำเข้ายอดขาย">
      <div>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-1.5 h-3.5 w-72" />
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
      <div>
        <Skeleton className="mb-2 h-4 w-32" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  );
}
