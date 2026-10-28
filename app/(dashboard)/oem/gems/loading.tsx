import { Skeleton } from "@/components/ui/Skeleton";

export default function OemGemsLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดแคตตาล็อกพลอย">
      <div>
        <Skeleton className="h-6 w-44" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <Skeleton className="h-11 w-72" />
      <div className="grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
