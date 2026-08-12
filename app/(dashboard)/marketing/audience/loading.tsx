import { Skeleton } from "@/components/ui/Skeleton";

export default function MarketingAudienceLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดกลุ่มลูกค้า">
      <Skeleton className="h-6 w-48" />
      <div className="flex gap-1.5">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
