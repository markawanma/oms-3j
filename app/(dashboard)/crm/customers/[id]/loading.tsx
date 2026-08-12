import { Skeleton } from "@/components/ui/Skeleton";

export default function CrmCustomerDetailLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดข้อมูลลูกค้า">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-zinc-200 bg-white p-3.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
