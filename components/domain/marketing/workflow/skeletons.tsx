// components/domain/marketing/workflow/skeletons.tsx — loading state ของหน้าในสาย content (ไม่แก้ components/ui/Skeleton.tsx)
import { Skeleton } from "@/components/ui/Skeleton";

function CardSkel({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-16" />
      </div>
      <Skeleton className="h-5 w-4/5" />
      {Array.from({ length: lines - 1 }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-2/3" />
      ))}
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

export function InboxSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดงานที่รอคุณ">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-6 w-36" />
          <CardSkel />
        </div>
      ))}
    </div>
  );
}

export function PieceDetailSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดชิ้นงาน">
      <Skeleton className="h-9 w-24" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-20" />
      </div>
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-12 w-full" />
      <CardSkel lines={4} />
      <CardSkel lines={5} />
      <CardSkel lines={3} />
    </div>
  );
}

export function QuestionsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="กำลังโหลดคำถามจาก AI">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-11 w-full max-w-xs" />
      <CardSkel lines={3} />
      <CardSkel lines={3} />
    </div>
  );
}
