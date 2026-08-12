import { Skeleton } from "@/components/ui/Skeleton";

export default function MarketingCopilotLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลด Ad Copilot">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
            <div className="flex-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
          </div>
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-3 h-9 w-40" />
        </div>
      ))}
      <Skeleton className="h-56 w-full rounded-lg" />
    </div>
  );
}
