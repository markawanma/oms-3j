import { Skeleton } from "@/components/ui/Skeleton";

export default function CalendarTaskDetailLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดรายละเอียดงาน">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <div className="space-y-2.5">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  );
}
