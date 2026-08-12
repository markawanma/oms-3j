import { Skeleton } from "@/components/ui/Skeleton";

export default function MarketingAttributionLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดข้อมูลวัดผลโค้ด">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-64 w-full rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
