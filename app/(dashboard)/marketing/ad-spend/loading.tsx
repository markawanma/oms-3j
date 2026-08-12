import { Skeleton } from "@/components/ui/Skeleton";

export default function MarketingAdSpendLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดหน้าค่าแอด">
      <div className="rounded-lg border border-zinc-200 bg-white p-3.5">
        <Skeleton className="h-4 w-24" />
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <Skeleton className="h-11 w-full rounded-md" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
        <Skeleton className="mt-2.5 h-11 w-full rounded-md" />
        <Skeleton className="mt-2.5 h-11 w-full rounded-md" />
        <Skeleton className="mt-3 h-11 w-24 self-end rounded-md" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
