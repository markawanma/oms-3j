import { Skeleton } from "@/components/ui/Skeleton";

// loading ของ /jobs/gems-to-buy — หัว + บรรทัดคงที่ + tablist + แถวตัวกรอง + ตาราง 6 แถว
export default function GemsToBuyLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดรายการพลอย">
      <div>
        <Skeleton className="h-6 w-44" />
        <Skeleton className="mt-2 h-4 w-32" />
      </div>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-11 w-56" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-72" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}
