import { Skeleton } from "@/components/ui/Skeleton";

export default function ProductionOrderDetailLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดใบผลิต">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-28 w-full rounded-lg" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}
