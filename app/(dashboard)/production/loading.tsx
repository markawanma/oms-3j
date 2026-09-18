import { Skeleton } from "@/components/ui/Skeleton";

export default function ProductionLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดใบผลิตเข้าสต็อก">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <Skeleton className="h-9 w-64 rounded-md" />
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
