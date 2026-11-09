import { Skeleton } from "@/components/ui/Skeleton";

export default function RingBuilderAdminLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดหลังบ้านออกแบบแหวน">
      <div>
        <Skeleton className="h-6 w-44" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <Skeleton className="h-11 w-96 max-w-full" />
      <Skeleton className="h-16 w-full rounded-lg" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
