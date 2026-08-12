import { Skeleton } from "@/components/ui/Skeleton";

export default function MarketingCalendarLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดปฏิทินแคมเปญ">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-72" />
      <div className="space-y-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
