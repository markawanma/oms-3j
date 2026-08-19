import { Skeleton } from "@/components/ui/Skeleton";

export default function OemRatesLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดต้นทุนงาน OEM">
      <div>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-40 w-full rounded-lg" />
      ))}
    </div>
  );
}
