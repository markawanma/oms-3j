import { Skeleton } from "@/components/ui/Skeleton";

export default function OversoldQueueLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดคิวของไม่พอ">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}
