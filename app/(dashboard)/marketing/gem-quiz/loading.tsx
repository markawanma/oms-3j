import { Skeleton } from "@/components/ui/Skeleton";

// Route-level Suspense fallback while the server page awaits
// getGemQuizStats() — mirrors /marketing/content/history/loading.tsx's shape.
export default function GemQuizStatsLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดสถิติแบบทดสอบเลือกพลอย">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-11 w-full max-w-sm rounded-md" />
      <Skeleton className="h-20 w-40 rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
