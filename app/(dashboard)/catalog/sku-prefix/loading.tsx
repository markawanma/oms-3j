import { Skeleton } from "@/components/ui/Skeleton";

export default function SkuPrefixLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดรายการ prefix">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
