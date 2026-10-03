import { Skeleton } from "@/components/ui/Skeleton";

// Route-level Suspense fallback while the server page awaits
// getTrendRadarFeed()/getContentTypes() — mirrors
// app/(dashboard)/marketing/content/history/loading.tsx's shape (header
// skeleton + blocks reserving each day's place so layout doesn't jump).
export default function TrendRadarLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดเรดาร์เทรนด์">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-6 w-56" />
    </div>
  );
}
